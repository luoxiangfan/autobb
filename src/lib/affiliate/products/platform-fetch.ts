import axios from 'axios'
import { load as loadHtml } from 'cheerio'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { fetchProxyIp } from '@/lib/scraping/proxy/fetch-proxy-ip'
import { generateRandomFingerprint } from '@/lib/scraping'
import { getYeahPromosSessionCookieForSync } from './yeahpromos-session'
import { getSetting, getUserOnlySetting } from '@/lib/common/server'
import type { AffiliateCommissionRateMode, AffiliatePlatform } from './types'
import type { NormalizedAffiliateProduct } from './types'
import { ConfigRequiredError } from './types'
import { checkAffiliatePlatformConfig, upsertUserSystemSetting } from './config'
import { normalizeTriStateBool, resolveConfirmedInvalidFromSignals } from './normalization'
import {
  AFFILIATE_YP_ACCESS_PRODUCTS_TARGET_KEY,
  AFFILIATE_YP_ACCESS_PRODUCTS_UPDATED_AT_KEY,
  DEFAULT_PB_ASIN_LINK_BATCH_SIZE,
  DEFAULT_PB_BASE_URL,
  DEFAULT_PB_PRODUCTS_LINK_BATCH_SIZE,
  DEFAULT_PB_PRODUCTS_PAGE_SIZE,
  DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS,
  DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS,
  DEFAULT_PB_RATE_LIMIT_MAX_RETRIES,
  DEFAULT_PB_REQUEST_DELAY_MS,
  DEFAULT_YP_PRODUCTS_DELAY_JITTER_MS,
  DEFAULT_YP_PRODUCTS_REQUEST_DELAY_MS,
  DEFAULT_YP_RATE_LIMIT_BASE_DELAY_MS,
  DEFAULT_YP_RATE_LIMIT_MAX_DELAY_MS,
  DEFAULT_YP_RATE_LIMIT_MAX_RETRIES,
  MAX_PB_ASIN_LINK_BATCH_SIZE,
  MAX_PB_ASINS_PER_REQUEST,
  MAX_PB_EMPTY_PAGE_STREAK,
  MAX_PB_PRODUCTS_LINK_BATCH_SIZE,
  MAX_PB_REQUEST_DELAY_MS,
  MAX_PB_SYNC_MAX_PAGES,
  MAX_YP_CONSECUTIVE_EMPTY_PAGES_PER_SCOPE,
  MAX_YP_EMPTY_PAGE_STREAK,
  MAX_YP_PRODUCTS_DELAY_JITTER_MS,
  MAX_YP_PRODUCTS_REQUEST_DELAY_MS,
  MAX_YP_SYNC_MAX_PAGES,
  MIN_YP_PRODUCTS_REQUEST_DELAY_MS,
  PB_LINK_HEARTBEAT_EVERY_BATCHES,
  YP_MARKETPLACE_TEMPLATES_SETTING_KEY,
  YP_SESSION_MIN_REMAINING_MS_INITIAL,
  YP_SESSION_MIN_REMAINING_MS_RESUME,
  DEFAULT_YP_SKIP_FAILED_PAGES,
  type PartnerboostAsinLinkResponse,
  type PartnerboostDtcProductsResponse,
  type PartnerboostLinkResponse,
  type PartnerboostProduct,
  type PartnerboostProductsResponse,
  type PartnerboostPromotableFetchParams,
  type PartnerboostPromotableFetchResult,
  type PlatformConfigCheck,
  type YeahPromosMarketplaceTemplate,
  type YeahPromosMerchant,
  type YeahPromosProductPageParseResult,
  type YeahPromosProductsFetchResult,
  type YeahPromosResponse,
} from './constants'
import {
  applyYeahPromosTemplateSiteId,
  assertPartnerboostAsinRequestLimit,
  buildYeahPromosProductsPageUrl,
  calculateExponentialBackoffDelay,
  computeCommissionAmount,
  detectYeahPromosHttpIntercept,
  extractAsinFromUrlLike,
  extractCurrencyUnitFromText,
  extractPartnerboostDtcProductsPayload,
  extractPartnerboostProductsPayload,
  extractYeahPromosPayload,
  isPartnerboostRateLimited,
  isPartnerboostRateLimitError,
  isPartnerboostTransientError,
  isProxyFatalError,
  isTransientHttpStatus,
  isTransientNetworkErrorMessage,
  isYeahPromosRateLimited,
  isYeahPromosRequestTooFastMessage,
  isYeahPromosTransientError,
  normalizeAsin,
  normalizeCountries,
  normalizeCurrencyUnit,
  normalizePartnerboostStatusCode,
  normalizeProxyCountryCode,
  normalizeYeahPromosMarketplace,
  normalizeUrl,
  normalizeYeahPromosResultCode,
  parseBooleanSetting,
  parseCsvValues,
  parseHttpStatusFromErrorMessage,
  parsePercentage,
  parseInteger,
  parseIntegerInRange,
  parsePartnerboostCommission,
  parsePriceAmount,
  parseReviewCount,
  parseYeahPromosMerchantCommission,
  parseYeahPromosProxyCountryUrlMap,
  randomIntInRange,
  resolvePartnerboostCountryCode,
  resolvePartnerboostFullSyncCountrySequence,
  resolvePartnerboostPromoLinks,
  resolveSyncMaxPages,
  resolveYeahPromosMarketplaceCountry,
  resolveYeahPromosMarketplaceTemplates,
  resolveYeahPromosProxyProviderUrl,
  sleep,
} from './parsing'

export function ensurePlatformConfigured(
  check: PlatformConfigCheck,
  platform: AffiliatePlatform
): void {
  if (check.configured) return
  throw new ConfigRequiredError(platform, check.missingKeys)
}

export async function fetchPartnerboostShortPromoLinkByAsin(params: {
  userId: number
  asin: string
  targetCountry: string
}): Promise<string | null> {
  const shortLinks = await fetchPartnerboostShortPromoLinksByAsins({
    userId: params.userId,
    asins: [params.asin],
    targetCountry: params.targetCountry,
  })
  const targetAsin = normalizeAsin(params.asin)
  if (!targetAsin) return null
  return shortLinks.get(targetAsin) || null
}

export async function fetchPartnerboostShortPromoLinksByAsins(params: {
  userId: number
  asins: string[]
  targetCountry: string
}): Promise<Map<string, string>> {
  const shortLinkByAsin = new Map<string, string>()
  const normalizedAsins = Array.from(
    new Set(
      (params.asins || [])
        .map((asin) => normalizeAsin(asin))
        .filter((asin): asin is string => Boolean(asin))
    )
  )
  if (normalizedAsins.length === 0) return shortLinkByAsin

  const check = await checkAffiliatePlatformConfig(params.userId, 'partnerboost')
  if (!check.configured) return shortLinkByAsin

  const token = (check.values.partnerboost_token || '').trim()
  if (!token) return shortLinkByAsin

  const baseUrl = (check.values.partnerboost_base_url || DEFAULT_PB_BASE_URL).replace(/\/+$/, '')
  const linkCountryCode = resolvePartnerboostCountryCode(
    check.values.partnerboost_link_country_code,
    params.targetCountry
  )
  const uid = check.values.partnerboost_link_uid || ''
  const returnPartnerboostLink = parseInteger(
    check.values.partnerboost_link_return_partnerboost_link || '1',
    1
  )
  const rateLimitRetryOptions: PartnerboostRequestRateLimitOptions = {
    maxRetries: parseIntegerInRange(
      check.values.partnerboost_rate_limit_max_retries || String(DEFAULT_PB_RATE_LIMIT_MAX_RETRIES),
      DEFAULT_PB_RATE_LIMIT_MAX_RETRIES,
      0,
      10
    ),
    baseDelayMs: parseIntegerInRange(
      check.values.partnerboost_rate_limit_base_delay_ms ||
        String(DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS),
      DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS,
      100,
      60000
    ),
    maxDelayMs: parseIntegerInRange(
      check.values.partnerboost_rate_limit_max_delay_ms ||
        String(DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS),
      DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS,
      500,
      120000
    ),
  }

  for (let index = 0; index < normalizedAsins.length; index += MAX_PB_ASINS_PER_REQUEST) {
    const batchAsins = normalizedAsins.slice(index, index + MAX_PB_ASINS_PER_REQUEST)
    const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostAsinLinkResponse>(
      `${baseUrl}/api/datafeed/get_amazon_link_by_asin`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          asins: batchAsins.join(','),
          country_code: linkCountryCode,
          uid,
          return_partnerboost_link: returnPartnerboostLink,
        }),
      },
      'PartnerBoost ASIN推广链接拉取失败',
      rateLimitRetryOptions
    )

    const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
    if (statusCode === null) {
      throw new Error(
        `PartnerBoost ASIN推广链接拉取失败: Invalid status code ${String(payload.status?.code)}`
      )
    }
    if (statusCode !== 0) {
      throw new Error(`PartnerBoost ASIN推广链接拉取失败: ${payload.status?.msg || statusCode}`)
    }

    for (const item of payload.data || []) {
      const asinKey = normalizeAsin(item.asin)
      const shortLink = normalizeUrl(item.partnerboost_link)
      if (!asinKey || !shortLink) continue
      shortLinkByAsin.set(asinKey, shortLink)
    }
  }

  return shortLinkByAsin
}

export async function fetchJsonOrThrow<T>(
  url: string,
  init: RequestInit,
  errorPrefix: string
): Promise<T> {
  const response = await fetch(url, init)
  const text = await response.text().catch(() => '')
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 220)

  if (!response.ok) {
    // 特殊处理 407 Proxy Authentication Required
    if (response.status === 407) {
      throw new Error(
        `${errorPrefix} (407): 代理认证失败 - IPRocket配额可能已用完或凭证失效，请检查代理服务余额和配置`
      )
    }

    throw new Error(`${errorPrefix} (${response.status}): ${snippet || '请求失败'}`)
  }

  const body = text.trim()
  if (!body) {
    throw new Error(`${errorPrefix} (${response.status}): Empty response body`)
  }

  try {
    return JSON.parse(body) as T
  } catch (error: any) {
    const parseMessage = String(error?.message || 'Failed to parse JSON response')
    const responseHint = snippet ? `; response=${snippet}` : ''
    throw new SyntaxError(`${errorPrefix} (${response.status}): ${parseMessage}${responseHint}`)
  }
}

type PartnerboostRequestRateLimitOptions = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

type YeahPromosRequestRateLimitOptions = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

export async function fetchPartnerboostJsonWithRateLimitRetry<
  T extends { status?: { code?: number | string; msg?: string } },
>(
  url: string,
  init: RequestInit,
  errorPrefix: string,
  options: PartnerboostRequestRateLimitOptions
): Promise<T> {
  let attempt = 0
  while (true) {
    let responseStatus: number | undefined
    try {
      const payload = await fetchJsonOrThrow<T>(url, init, errorPrefix)
      const payloadStatusCode = normalizePartnerboostStatusCode(payload?.status?.code)
      const payloadStatusMessage = String(payload?.status?.msg || '')

      if (
        isPartnerboostRateLimited(payloadStatusCode, payloadStatusMessage, responseStatus) &&
        attempt < options.maxRetries
      ) {
        attempt += 1
        const delayMs = calculateExponentialBackoffDelay(
          attempt,
          options.baseDelayMs,
          options.maxDelayMs
        )
        console.warn(
          `[partnerboost] rate limited(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`
        )
        await sleep(delayMs)
        continue
      }

      return payload
    } catch (error: any) {
      const message = String(error?.message || '')
      responseStatus = parseHttpStatusFromErrorMessage(message)
      const payloadStatusCode = normalizePartnerboostStatusCode(error?.status?.code)
      const payloadStatusMessage = String(error?.status?.msg || message)

      // ❌ 检测代理致命错误（不可重试）
      if (isProxyFatalError(error)) {
        console.error(`[partnerboost] 代理致命错误，停止重试: ${message}`)
        throw error
      }

      const isRateLimited = isPartnerboostRateLimited(
        payloadStatusCode,
        payloadStatusMessage,
        responseStatus
      )
      const isTransient = !isRateLimited && isPartnerboostTransientError(error)

      if ((isRateLimited || isTransient) && attempt < options.maxRetries) {
        attempt += 1
        const delayMs = calculateExponentialBackoffDelay(
          attempt,
          options.baseDelayMs,
          options.maxDelayMs
        )
        const retryReason = isRateLimited ? 'rate limited' : 'transient error'
        console.warn(
          `[partnerboost] ${retryReason}(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`
        )
        await sleep(delayMs)
        continue
      }

      throw error
    }
  }
}

export async function fetchPartnerboostDtcPromotableProductsWithMeta(input: {
  baseUrl: string
  token: string
  brandId: string | null
  pageSize: number
  startPage: number
  maxPages: number | null
  requestDelayMs: number
  rateLimitRetryOptions: PartnerboostRequestRateLimitOptions
}): Promise<PartnerboostPromotableFetchResult> {
  const items: NormalizedAffiliateProduct[] = []
  let page = input.startPage
  let hasMore = true
  let fetchedPages = 0

  while (hasMore && (input.maxPages === null || fetchedPages < input.maxPages)) {
    const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostDtcProductsResponse>(
      `${input.baseUrl}/api.php?mod=datafeed&op=list`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: input.token,
          brand_type: 'DTC',
          brand_id: input.brandId || undefined,
          page,
          limit: input.pageSize,
        }),
      },
      'PartnerBoost DTC 商品拉取失败',
      input.rateLimitRetryOptions
    )

    const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
    if (statusCode === null) {
      throw new Error(
        `PartnerBoost DTC 商品拉取失败: Invalid status code ${String(payload.status?.code)}`
      )
    }
    if (statusCode !== 0) {
      throw new Error(`PartnerBoost DTC 商品拉取失败: ${payload.status?.msg || statusCode}`)
    }

    const extracted = extractPartnerboostDtcProductsPayload({
      payload,
      page,
      pageSize: input.pageSize,
    })
    fetchedPages += 1
    hasMore = extracted.hasMore

    for (const product of extracted.products) {
      const shortPromoLink = normalizeUrl(product.tracking_url_short)
      const promoLink =
        shortPromoLink ||
        normalizeUrl(product.tracking_url_smart) ||
        normalizeUrl(product.tracking_url)
      if (!promoLink) continue

      const mid = normalizeUrl(
        typeof product.creative_id === 'string' || typeof product.creative_id === 'number'
          ? String(product.creative_id)
          : product.sku || product.url || ''
      )
      if (!mid) continue

      const priceAmount = parsePriceAmount(product.price ?? product.old_price)
      const priceCurrency = normalizeCurrencyUnit(product.currency)
      const asin = extractAsinFromUrlLike(product.url)
      const merchantId = normalizeUrl(
        typeof product.brand_id === 'string' || typeof product.brand_id === 'number'
          ? String(product.brand_id)
          : product.mcid || ''
      )

      items.push({
        platform: 'partnerboost',
        mid,
        merchantId,
        asin,
        brand: normalizeUrl(product.brand || product.merchant_name),
        productName: normalizeUrl(product.name),
        productUrl: normalizeUrl(product.url),
        promoLink,
        shortPromoLink,
        allowedCountries: normalizeCountries(product.country_code ?? product.country ?? ''),
        priceAmount,
        priceCurrency,
        commissionRate: null,
        commissionAmount: null,
        commissionRateMode: 'percent',
        reviewCount: null,
        isDeepLink: null,
        isConfirmedInvalid: resolveConfirmedInvalidFromSignals({
          availability: product.availability,
        }),
      })
    }

    page += 1
    if (hasMore && input.requestDelayMs > 0) {
      await sleep(input.requestDelayMs)
    }
  }

  return {
    items,
    hasMore,
    nextPage: page,
    fetchedPages,
  }
}

export async function fetchYeahPromosJsonWithRateLimitRetry<
  T extends {
    Code?: number | string
    code?: number | string
    message?: string
    msg?: string
  },
>(
  url: string,
  init: RequestInit,
  errorPrefix: string,
  options: YeahPromosRequestRateLimitOptions
): Promise<T> {
  let attempt = 0
  const resolveRetryDelayMs = (retryAttempt: number, errorMessage: string): number => {
    const backoffDelayMs = calculateExponentialBackoffDelay(
      retryAttempt,
      options.baseDelayMs,
      options.maxDelayMs
    )

    if (!isYeahPromosRequestTooFastMessage(errorMessage)) {
      return backoffDelayMs
    }

    const minDelayForTooFastMs = Math.min(options.maxDelayMs, 2000 * retryAttempt)
    return Math.max(backoffDelayMs, minDelayForTooFastMs)
  }

  while (true) {
    let responseStatus: number | undefined
    try {
      const payload = await fetchJsonOrThrow<T>(url, init, errorPrefix)
      const code = normalizeYeahPromosResultCode(payload?.Code ?? payload?.code)
      const message = String(payload?.message || payload?.msg || '')

      if (isYeahPromosRateLimited(code, message, responseStatus) && attempt < options.maxRetries) {
        attempt += 1
        const delayMs = resolveRetryDelayMs(attempt, message)
        console.warn(
          `[yeahpromos] rate limited(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`
        )
        await sleep(delayMs)
        continue
      }

      return payload
    } catch (error: any) {
      const message = String(error?.message || '')
      const statusMatch = message.match(/\((\d{3})\):/)
      responseStatus = statusMatch ? Number(statusMatch[1]) : undefined

      // ❌ 检测代理致命错误（不可重试）
      if (isProxyFatalError(error)) {
        console.error(`[yeahpromos] 代理致命错误，停止重试: ${message}`)
        throw error
      }

      const isRateLimited = isYeahPromosRateLimited(null, message, responseStatus)
      const isTransient = !isRateLimited && isYeahPromosTransientError(error)

      if ((isRateLimited || isTransient) && attempt < options.maxRetries) {
        attempt += 1
        const delayMs = resolveRetryDelayMs(attempt, message)
        const retryReason = isRateLimited ? 'rate limited' : 'transient error'
        console.warn(
          `[yeahpromos] ${retryReason}(${errorPrefix}), retry ${attempt}/${options.maxRetries} after ${delayMs}ms`
        )
        await sleep(delayMs)
        continue
      }

      throw error
    }
  }
}

export async function fetchPartnerboostPromotableProductsWithMeta(
  params: PartnerboostPromotableFetchParams
): Promise<PartnerboostPromotableFetchResult> {
  const check = await checkAffiliatePlatformConfig(params.userId, 'partnerboost')
  ensurePlatformConfigured(check, 'partnerboost')

  const token = check.values.partnerboost_token
  const baseUrl = (check.values.partnerboost_base_url || DEFAULT_PB_BASE_URL).replace(/\/+$/, '')
  const pageSize = Math.max(
    1,
    Math.min(
      parseInteger(
        check.values.partnerboost_products_page_size || String(DEFAULT_PB_PRODUCTS_PAGE_SIZE),
        DEFAULT_PB_PRODUCTS_PAGE_SIZE
      ),
      200
    )
  )
  const configuredStartPage = Math.max(
    1,
    parseInteger(check.values.partnerboost_products_page || '1', 1)
  )
  const startPage = Math.max(1, parseInteger(params.startPage, configuredStartPage))
  const defaultFilter = parseInteger(check.values.partnerboost_products_default_filter || '0', 0)
  const countryCode = resolvePartnerboostCountryCode(
    params.countryCodeOverride,
    check.values.partnerboost_products_country_code
  )
  const brandId = (check.values.partnerboost_products_brand_id || '').trim() || null
  const sort = check.values.partnerboost_products_sort || ''
  const relationship = parseInteger(check.values.partnerboost_products_relationship || '1', 1)
  const isOriginalCurrency = parseInteger(
    check.values.partnerboost_products_is_original_currency || '0',
    0
  )
  const hasPromoCode = parseInteger(check.values.partnerboost_products_has_promo_code || '0', 0)
  const hasAcc = parseInteger(check.values.partnerboost_products_has_acc || '0', 0)
  const filterSexual = parseInteger(
    check.values.partnerboost_products_filter_sexual_wellness || '0',
    0
  )
  const productLinkBatchSize = parseIntegerInRange(
    check.values.partnerboost_products_link_batch_size ||
      String(DEFAULT_PB_PRODUCTS_LINK_BATCH_SIZE),
    DEFAULT_PB_PRODUCTS_LINK_BATCH_SIZE,
    1,
    MAX_PB_PRODUCTS_LINK_BATCH_SIZE
  )
  const asinLinkBatchSize = parseIntegerInRange(
    check.values.partnerboost_asin_link_batch_size || String(DEFAULT_PB_ASIN_LINK_BATCH_SIZE),
    DEFAULT_PB_ASIN_LINK_BATCH_SIZE,
    1,
    MAX_PB_ASIN_LINK_BATCH_SIZE
  )
  const requestDelayMs = parseIntegerInRange(
    check.values.partnerboost_request_delay_ms || String(DEFAULT_PB_REQUEST_DELAY_MS),
    DEFAULT_PB_REQUEST_DELAY_MS,
    0,
    MAX_PB_REQUEST_DELAY_MS
  )
  const rateLimitRetryOptions: PartnerboostRequestRateLimitOptions = {
    maxRetries: parseIntegerInRange(
      check.values.partnerboost_rate_limit_max_retries || String(DEFAULT_PB_RATE_LIMIT_MAX_RETRIES),
      DEFAULT_PB_RATE_LIMIT_MAX_RETRIES,
      0,
      10
    ),
    baseDelayMs: parseIntegerInRange(
      check.values.partnerboost_rate_limit_base_delay_ms ||
        String(DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS),
      DEFAULT_PB_RATE_LIMIT_BASE_DELAY_MS,
      100,
      60000
    ),
    maxDelayMs: parseIntegerInRange(
      check.values.partnerboost_rate_limit_max_delay_ms ||
        String(DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS),
      DEFAULT_PB_RATE_LIMIT_MAX_DELAY_MS,
      500,
      120000
    ),
  }
  const configuredAsins = parseCsvValues(check.values.partnerboost_products_asins || '')
  const allAsins = Array.from(new Set([...(params.asins || []), ...configuredAsins]))
    .map((asin) => normalizeAsin(asin))
    .filter((asin): asin is string => Boolean(asin))
  assertPartnerboostAsinRequestLimit(allAsins)
  const linkCountryCode = resolvePartnerboostCountryCode(
    params.linkCountryCodeOverride ?? check.values.partnerboost_link_country_code,
    countryCode
  )
  const uid = check.values.partnerboost_link_uid || ''
  const returnPartnerboostLink = parseInteger(
    check.values.partnerboost_link_return_partnerboost_link || '1',
    1
  )
  const isAsinTargetedSync = allAsins.length > 0
  const defaultMaxPages = isAsinTargetedSync ? 1 : null
  const maxPages = resolveSyncMaxPages(params.maxPages, defaultMaxPages, MAX_PB_SYNC_MAX_PAGES)
  const fullSyncCountrySequence = resolvePartnerboostFullSyncCountrySequence()
  const includeDtcProducts = !isAsinTargetedSync && countryCode === fullSyncCountrySequence[0]

  const products: PartnerboostProduct[] = []
  let page = startPage
  let hasMore = true
  let fetchedPages = 0
  let emptyPageStreak = 0
  let lastFetchProgressCount = 0

  const emitFetchProgress = async (force: boolean = false): Promise<void> => {
    if (!params.onFetchProgress) return
    if (!force && products.length === lastFetchProgressCount) return
    lastFetchProgressCount = products.length
    try {
      await params.onFetchProgress(products.length)
    } catch (error: any) {
      console.warn('[partnerboost] onFetchProgress callback failed:', error?.message || error)
    }
  }

  while (hasMore && (maxPages === null || fetchedPages < maxPages)) {
    const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostProductsResponse>(
      `${baseUrl}/api/datafeed/get_fba_products`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          page_size: pageSize,
          page,
          default_filter: defaultFilter,
          country_code: countryCode,
          brand_id: brandId,
          sort,
          asins: allAsins.join(','),
          relationship,
          is_original_currency: isOriginalCurrency,
          has_promo_code: hasPromoCode,
          has_acc: hasAcc,
          filter_sexual_wellness: filterSexual,
        }),
      },
      'PartnerBoost 商品拉取失败',
      rateLimitRetryOptions
    )

    const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
    if (statusCode === null) {
      throw new Error(
        `PartnerBoost 商品拉取失败: Invalid status code ${String(payload.status?.code)}`
      )
    }
    if (statusCode !== 0) {
      throw new Error(`PartnerBoost 商品拉取失败: ${payload.status?.msg || statusCode}`)
    }

    const extracted = extractPartnerboostProductsPayload(payload)
    products.push(...extracted.products)
    hasMore = extracted.hasMore
    fetchedPages += 1

    if (fetchedPages === 1 || fetchedPages % 5 === 0 || !hasMore) {
      await emitFetchProgress()
    }

    if (!isAsinTargetedSync && hasMore) {
      if (extracted.products.length === 0) {
        emptyPageStreak += 1
        if (emptyPageStreak >= MAX_PB_EMPTY_PAGE_STREAK) {
          console.warn(
            `[partnerboost] received ${emptyPageStreak} consecutive empty pages with has_more=true; stopping early to avoid infinite pagination`
          )
          hasMore = false
        }
      } else {
        emptyPageStreak = 0
      }
    } else {
      emptyPageStreak = 0
    }

    page += 1

    if (isAsinTargetedSync) {
      hasMore = false
    }

    if (hasMore && requestDelayMs > 0) {
      await sleep(requestDelayMs)
    }
  }

  if (
    !isAsinTargetedSync &&
    maxPages !== null &&
    hasMore &&
    fetchedPages >= maxPages &&
    !params.suppressMaxPagesWarning
  ) {
    console.warn(
      `[partnerboost] reached page limit (${maxPages}) while has_more=true; results may be truncated`
    )
  }

  await emitFetchProgress(true)

  const productIds = products.map((item) => String(item.product_id || '').trim()).filter(Boolean)

  const linkMap = new Map<string, string>()
  let rateLimitedProductLinkBatchCount = 0
  let productLinkBatchProcessed = 0
  for (let index = 0; index < productIds.length; index += productLinkBatchSize) {
    const batchIds = productIds.slice(index, index + productLinkBatchSize)
    try {
      const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostLinkResponse>(
        `${baseUrl}/api/datafeed/get_fba_products_link`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            product_ids: batchIds.join(','),
            uid,
          }),
        },
        'PartnerBoost 推广链接拉取失败',
        rateLimitRetryOptions
      )

      const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
      if (statusCode === null) {
        throw new Error(
          `PartnerBoost 推广链接拉取失败: Invalid status code ${String(payload.status?.code)}`
        )
      }
      if (statusCode !== 0) {
        throw new Error(`PartnerBoost 推广链接拉取失败: ${payload.status?.msg || statusCode}`)
      }

      for (const item of payload.data || []) {
        const productId = String(item.product_id || '').trim()
        const link = normalizeUrl(item.partnerboost_link || item.link)
        if (!productId || !link) continue
        linkMap.set(productId, link)
      }
    } catch (error) {
      if (!isPartnerboostRateLimitError(error)) {
        throw error
      }

      rateLimitedProductLinkBatchCount += 1
      console.warn(
        `[partnerboost] product link batch rate-limited, falling back to ASIN link for this batch (${index + 1}-${Math.min(index + productLinkBatchSize, productIds.length)}/${productIds.length})`
      )
    }

    const hasRemaining = index + productLinkBatchSize < productIds.length
    productLinkBatchProcessed += 1
    if (productLinkBatchProcessed % PB_LINK_HEARTBEAT_EVERY_BATCHES === 0 || !hasRemaining) {
      await emitFetchProgress(true)
    }

    if (hasRemaining && requestDelayMs > 0) {
      await sleep(requestDelayMs)
    }
  }

  const asinLinkMap = new Map<string, { link: string | null; partnerboostLink: string | null }>()
  // 优先使用 product_id 链接；仅对缺失 product_id 链接的商品补查 ASIN 链接，
  // 可显著减少 API 请求量并降低触发 429 的概率。
  const linkLookupAsins = Array.from(
    new Set(
      products
        .filter((item) => {
          const productId = String(item.product_id || '').trim()
          return !productId || !linkMap.has(productId)
        })
        .map((item) => normalizeAsin(item.asin))
        .filter((asin): asin is string => Boolean(asin))
    )
  )
  let asinLinkBatchProcessed = 0
  for (let index = 0; index < linkLookupAsins.length; index += asinLinkBatchSize) {
    const batchAsins = linkLookupAsins.slice(index, index + asinLinkBatchSize)
    try {
      const payload = await fetchPartnerboostJsonWithRateLimitRetry<PartnerboostAsinLinkResponse>(
        `${baseUrl}/api/datafeed/get_amazon_link_by_asin`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            asins: batchAsins.join(','),
            country_code: linkCountryCode,
            uid,
            return_partnerboost_link: returnPartnerboostLink,
          }),
        },
        'PartnerBoost ASIN推广链接拉取失败',
        rateLimitRetryOptions
      )

      const statusCode = normalizePartnerboostStatusCode(payload.status?.code)
      if (statusCode === null) {
        throw new Error(
          `PartnerBoost ASIN推广链接拉取失败: Invalid status code ${String(payload.status?.code)}`
        )
      }
      if (statusCode !== 0) {
        throw new Error(`PartnerBoost ASIN推广链接拉取失败: ${payload.status?.msg || statusCode}`)
      }

      for (const item of payload.data || []) {
        const asinKey = normalizeAsin(item.asin)
        if (!asinKey) continue

        asinLinkMap.set(asinKey, {
          link: normalizeUrl(item.link),
          partnerboostLink: normalizeUrl(item.partnerboost_link),
        })
      }
    } catch (error) {
      if (!isPartnerboostRateLimitError(error)) {
        throw error
      }

      console.warn(
        `[partnerboost] asin link batch rate-limited; stop remaining ASIN enrichment (${index + 1}-${Math.min(index + asinLinkBatchSize, linkLookupAsins.length)}/${linkLookupAsins.length})`
      )
      break
    }

    const hasRemaining = index + asinLinkBatchSize < linkLookupAsins.length
    asinLinkBatchProcessed += 1
    if (asinLinkBatchProcessed % PB_LINK_HEARTBEAT_EVERY_BATCHES === 0 || !hasRemaining) {
      await emitFetchProgress(true)
    }

    if (hasRemaining && requestDelayMs > 0) {
      await sleep(requestDelayMs)
    }
  }

  if (rateLimitedProductLinkBatchCount > 0) {
    console.warn(
      `[partnerboost] product link batches rate-limited: ${rateLimitedProductLinkBatchCount}; used ASIN fallback for missing links`
    )
  }

  const amazonItems: NormalizedAffiliateProduct[] = []
  for (const item of products) {
    const mid = String(item.product_id || '').trim()
    if (!mid) continue

    const asinKey = normalizeAsin(item.asin)
    const asinLinks = asinKey ? asinLinkMap.get(asinKey) : undefined
    const resolvedLinks = resolvePartnerboostPromoLinks({
      productIdLink: linkMap.get(mid) || null,
      asinLink: asinLinks?.link || null,
      asinPartnerboostLink: asinLinks?.partnerboostLink || null,
    })

    const promoLink = resolvedLinks.promoLink
    if (!promoLink) {
      continue
    }

    const priceAmount = parsePriceAmount(item.discount_price ?? item.original_price)
    const priceCurrency = normalizeCurrencyUnit(item.currency)
    const parsedCommission = parsePartnerboostCommission(
      item.acc_commission ?? item.commission,
      priceCurrency
    )
    const commissionRate =
      parsedCommission.mode === 'percent' ? parsedCommission.rate : parsedCommission.amount
    const allowedCountries = normalizeCountries(item.country_code)
    const reviewCount = parseReviewCount(
      item.review_count ??
        item.reviewCount ??
        item.reviews ??
        item.rating_count ??
        item.ratings_total
    )
    const merchantId = normalizeUrl(
      typeof item.brand_id === 'string' || typeof item.brand_id === 'number'
        ? String(item.brand_id)
        : typeof item.brandId === 'string' || typeof item.brandId === 'number'
          ? String(item.brandId)
          : typeof item.bid === 'string' || typeof item.bid === 'number'
            ? String(item.bid)
            : ''
    )
    const isDeepLink = normalizeTriStateBool((item as any).is_deeplink ?? (item as any).isDeepLink)
    const isConfirmedInvalid = resolveConfirmedInvalidFromSignals({
      advertStatus: (item as any).advert_status,
      status: (item as any).status,
      availability: (item as any).availability,
      stockStatus: (item as any).stock_status,
      isAvailable: (item as any).is_available,
      inStock: (item as any).in_stock,
      isOos: (item as any).is_oos,
    })

    amazonItems.push({
      platform: 'partnerboost',
      mid,
      merchantId,
      asin: normalizeUrl(item.asin),
      brand: normalizeUrl(item.brand_name),
      productName: normalizeUrl(item.product_name),
      productUrl: normalizeUrl(item.url),
      promoLink,
      shortPromoLink: resolvedLinks.shortPromoLink,
      allowedCountries,
      priceAmount,
      priceCurrency,
      commissionRate,
      commissionAmount:
        parsedCommission.mode === 'amount'
          ? parsedCommission.amount
          : computeCommissionAmount(priceAmount, commissionRate),
      commissionRateMode: parsedCommission.mode,
      reviewCount,
      isDeepLink,
      isConfirmedInvalid,
    })
  }

  let dtcResult: PartnerboostPromotableFetchResult = {
    items: [],
    hasMore: false,
    nextPage: startPage,
    fetchedPages: 0,
  }
  if (includeDtcProducts) {
    dtcResult = await fetchPartnerboostDtcPromotableProductsWithMeta({
      baseUrl,
      token,
      brandId,
      pageSize,
      startPage,
      maxPages,
      requestDelayMs,
      rateLimitRetryOptions,
    })
  }

  return {
    items: [...amazonItems, ...dtcResult.items],
    hasMore: hasMore || dtcResult.hasMore,
    nextPage: Math.max(page, dtcResult.nextPage),
    fetchedPages: Math.max(fetchedPages, dtcResult.fetchedPages),
  }
}

export async function fetchPartnerboostPromotableProducts(
  params: PartnerboostPromotableFetchParams
): Promise<NormalizedAffiliateProduct[]> {
  const result = await fetchPartnerboostPromotableProductsWithMeta(params)
  return result.items
}

export async function loadYeahPromosMarketplaceTemplates(params: {
  userId: number
  preloadedSettings?: Record<string, string>
}): Promise<YeahPromosMarketplaceTemplate[]> {
  const preloadedValue = String(
    params.preloadedSettings?.[YP_MARKETPLACE_TEMPLATES_SETTING_KEY] || ''
  ).trim()
  const templates = preloadedValue
    ? resolveYeahPromosMarketplaceTemplates(preloadedValue)
    : resolveYeahPromosMarketplaceTemplates(
        (await getSetting('openclaw', YP_MARKETPLACE_TEMPLATES_SETTING_KEY, params.userId))
          ?.value || ''
      )

  const preloadedSiteId = String(params.preloadedSettings?.yeahpromos_site_id || '').trim()
  const resolvedSiteId =
    preloadedSiteId ||
    String(
      (await getSetting('affiliate_sync', 'yeahpromos_site_id', params.userId))?.value || ''
    ).trim()

  return applyYeahPromosTemplateSiteId(templates, resolvedSiteId)
}

export async function loadYeahPromosCountryProxyMap(userId: number): Promise<Map<string, string>> {
  const proxySetting = await getUserOnlySetting('proxy', 'urls', userId)
  return parseYeahPromosProxyCountryUrlMap(proxySetting?.value || '')
}

export async function createYeahPromosProxyAgent(params: {
  proxyProviderUrl: string
  country: string
  reason: string
}): Promise<HttpsProxyAgent<string>> {
  const proxy = await fetchProxyIp(params.proxyProviderUrl, 3, false)
  console.log(`[yeahpromos] proxy ${params.country} (${params.reason}): ${proxy.fullAddress}`)
  return new HttpsProxyAgent(
    `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`,
    {
      keepAlive: true,
      timeout: 60000,
    }
  )
}

export async function fetchYeahPromosAccessProductsCount(params: {
  userId: number
  siteId: string
  sessionCookie: string
  proxyAgent?: HttpsProxyAgent<string>
}): Promise<number | null> {
  const url = new URL('https://yeahpromos.com/index/offer/report_performance')
  url.searchParams.set('site_id', params.siteId)

  const agent = params.proxyAgent
  const fingerprint = generateRandomFingerprint()

  // 构建完整的 HTTP 头部（参考 browser-stealth.ts）
  const headers: Record<string, string> = {
    Cookie: params.sessionCookie,
    Accept: fingerprint.accept,
    'Accept-Language': fingerprint.acceptLanguage,
    'Accept-Encoding': fingerprint.acceptEncoding!,
    'User-Agent': fingerprint.userAgent,
    Connection: fingerprint.connection!,
    'Upgrade-Insecure-Requests': fingerprint.upgradeInsecureRequests!,
    'Sec-Fetch-Dest': fingerprint.secFetchDest!,
    'Sec-Fetch-Mode': fingerprint.secFetchMode!,
    'Sec-Fetch-Site': fingerprint.secFetchSite!,
    'Sec-Fetch-User': fingerprint.secFetchUser!,
    'Cache-Control': fingerprint.cacheControl!,
    DNT: fingerprint.dnt!,
  }

  // 只有 Chrome/Edge 才发送 Sec-CH-UA 头部
  if (fingerprint.secChUa) {
    headers['Sec-CH-UA'] = fingerprint.secChUa
    headers['Sec-CH-UA-Mobile'] = fingerprint.secChUaMobile!
    headers['Sec-CH-UA-Platform'] = fingerprint.secChUaPlatform!
  }

  const response = await axios.get(url.toString(), {
    headers,
    httpsAgent: agent,
    httpAgent: agent,
    maxRedirects: 5,
    validateStatus: () => true,
    responseType: 'text',
    timeout: 60000,
  })
  const html = typeof response.data === 'string' ? response.data : ''

  if (response.status < 200 || response.status >= 300) {
    return null
  }

  const redirectedUrl = normalizeUrl(response.request?.res?.responseUrl) || ''
  const isLoginRedirect =
    redirectedUrl.includes('/index/login/login') ||
    redirectedUrl.includes('/index/index/login') ||
    /action=\"\/index\/login\/login\"/i.test(html)
  if (isLoginRedirect) {
    return null
  }

  const match = html.match(/Access\\s*Products\\s*:\\s*([0-9,]+)/i)
  if (!match?.[1]) {
    return null
  }

  const parsed = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  const normalized = Math.trunc(parsed)
  const nowIso = new Date().toISOString()
  await Promise.all([
    upsertUserSystemSetting({
      userId: params.userId,
      key: AFFILIATE_YP_ACCESS_PRODUCTS_TARGET_KEY,
      value: String(normalized),
      description: 'YP Access Products 最新目标总量',
    }),
    upsertUserSystemSetting({
      userId: params.userId,
      key: AFFILIATE_YP_ACCESS_PRODUCTS_UPDATED_AT_KEY,
      value: nowIso,
      description: 'YP Access Products 最近更新时间',
    }),
  ])

  return normalized
}

export function normalizeYeahPromosStoreMerchant(input: {
  merchant: YeahPromosMerchant
  siteId: string
}): NormalizedAffiliateProduct | null {
  const merchant = input.merchant
  const merchantId = normalizeUrl(
    typeof merchant.mid === 'string' || typeof merchant.mid === 'number'
      ? String(merchant.mid)
      : typeof merchant.id === 'string' || typeof merchant.id === 'number'
        ? String(merchant.id)
        : typeof merchant.advert_id === 'string' || typeof merchant.advert_id === 'number'
          ? String(merchant.advert_id)
          : ''
  )
  if (!merchantId) return null

  const advertId = normalizeUrl(
    typeof merchant.advert_id === 'string' || typeof merchant.advert_id === 'number'
      ? String(merchant.advert_id)
      : merchantId
  )
  const track = normalizeUrl(merchant.track)
  const promoLink =
    normalizeYeahPromosPromoUrl(merchant.tracking_url) || buildYeahPromosTrackPromoUrl(track)
  if (!promoLink) return null

  const parsedCommission = parseYeahPromosMerchantCommission(
    merchant.avg_payout,
    merchant.payout_unit
  )
  const commissionRateMode: AffiliateCommissionRateMode =
    parsedCommission.mode === 'amount' ? 'amount' : 'percent'
  const productUrl =
    normalizeUrl(merchant.url) ||
    normalizeUrl(merchant.site_url) ||
    buildYeahPromosAdvertContentUrl(advertId, input.siteId)

  const reviewCount = parseReviewCount(
    merchant.review_count ??
      merchant.reviewCount ??
      merchant.reviews ??
      merchant.rating_count ??
      merchant.ratings_total
  )
  const isDeepLink = normalizeTriStateBool(merchant.is_deeplink)
  const isConfirmedInvalid = resolveConfirmedInvalidFromSignals({
    advertStatus: merchant.advert_status,
    status: merchant.status ?? merchant.merchant_status,
    availability: null,
    stockStatus: null,
    joinStatus: merchant.merchant_status,
    isAvailable: null,
    inStock: null,
    isOos: null,
  })

  return {
    platform: 'yeahpromos',
    mid: `store_${advertId || merchantId}`,
    merchantId,
    asin: null,
    brand: normalizeUrl(merchant.merchant_name),
    productName: normalizeUrl(merchant.merchant_name),
    productUrl,
    promoLink,
    shortPromoLink: null,
    allowedCountries: normalizeCountries(merchant.country),
    priceAmount: null,
    priceCurrency: null,
    commissionRate: commissionRateMode === 'percent' ? parsedCommission.rate : null,
    commissionAmount: commissionRateMode === 'amount' ? parsedCommission.amount : null,
    commissionRateMode,
    reviewCount,
    isDeepLink,
    isConfirmedInvalid,
  }
}

export async function fetchYeahPromosPromotableStores(params: {
  token: string
  siteId: string
  pageSize: number
  requestDelayMs: number
  rateLimitRetryOptions: YeahPromosRequestRateLimitOptions
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<NormalizedAffiliateProduct[]> {
  const items: NormalizedAffiliateProduct[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const url = new URL('https://yeahpromos.com/index/getadvert/getadvert')
    url.searchParams.set('site_id', params.siteId)
    url.searchParams.set('elite', '0')
    url.searchParams.set('page', String(page))
    url.searchParams.set('limit', String(params.pageSize))

    const payload = await fetchYeahPromosJsonWithRateLimitRetry<YeahPromosResponse>(
      url.toString(),
      {
        method: 'GET',
        headers: {
          token: params.token,
          Accept: 'application/json',
        },
      },
      'YeahPromos 店铺信息拉取失败',
      params.rateLimitRetryOptions
    )

    const code = normalizeYeahPromosResultCode(payload?.Code ?? payload?.code)
    if (code !== null && code !== 100000) {
      throw new Error(
        `YeahPromos 店铺信息拉取失败: ${String(payload?.message || payload?.msg || code)}`
      )
    }

    const extracted = extractYeahPromosPayload(payload)
    for (const merchant of extracted.merchants) {
      const normalized = normalizeYeahPromosStoreMerchant({
        merchant,
        siteId: params.siteId,
      })
      if (!normalized) continue
      items.push(normalized)
    }

    if (params.onFetchProgress) {
      await params.onFetchProgress(items.length)
    }

    const pageTotal = extracted.pageTotal
    const pageNow = extracted.pageNow ?? page
    hasMore =
      pageTotal !== null ? pageNow < pageTotal : extracted.merchants.length >= params.pageSize
    page += 1

    if (hasMore && params.requestDelayMs > 0) {
      await sleep(params.requestDelayMs)
    }
  }

  return items
}

export function extractYeahPromosPageNumberFromHref(
  href: string | null | undefined
): number | null {
  const rawHref = normalizeUrl(href)
  if (!rawHref) return null

  try {
    const url = new URL(rawHref, 'https://yeahpromos.com')
    const page = parseInteger(url.searchParams.get('page') || '', NaN)
    if (!Number.isFinite(page) || page <= 0) return null
    return page
  } catch {
    return null
  }
}

export function resolveYeahPromosPromoIdentifiers(promoLink: string | null): {
  pid: string | null
  track: string | null
} {
  const rawPromoLink = normalizeUrl(promoLink)
  if (!rawPromoLink) {
    return { pid: null, track: null }
  }

  try {
    const url = new URL(rawPromoLink, 'https://yeahpromos.com')
    const pid = normalizeUrl(url.searchParams.get('pid'))
    const track = normalizeUrl(url.searchParams.get('track'))
    return { pid, track }
  } catch {
    const pidMatch = rawPromoLink.match(/[?&]pid=([^&#]+)/i)
    const trackMatch = rawPromoLink.match(/[?&]track=([^&#]+)/i)
    return {
      pid: normalizeUrl(pidMatch?.[1] || null),
      track: normalizeUrl(trackMatch?.[1] || null),
    }
  }
}

export function buildYeahPromosTrackPromoUrl(track: string | null): string | null {
  const normalizedTrack = normalizeUrl(track)
  if (!normalizedTrack) return null

  try {
    const url = new URL('https://yeahpromos.com/index/index/openurl')
    url.searchParams.set('track', normalizedTrack)
    url.searchParams.set('url', '')
    return normalizeUrl(url.toString())
  } catch {
    return null
  }
}

export function buildYeahPromosAdvertContentUrl(
  advertId: string | null,
  siteId: string | null
): string | null {
  const normalizedAdvertId = normalizeUrl(advertId)
  const normalizedSiteId = normalizeUrl(siteId)
  if (!normalizedAdvertId || !normalizedSiteId) return null

  try {
    const url = new URL('https://yeahpromos.com/index/advert/advert_content')
    url.searchParams.set('advert_id', normalizedAdvertId)
    url.searchParams.set('site_id', normalizedSiteId)
    return normalizeUrl(url.toString())
  } catch {
    return null
  }
}

const YEAHPROMOS_PROMO_PATH_PATTERN = /\/index\/index\/openurl(?:product)?\?/i

export function decodeHtmlEntitiesForUrl(input: string): string {
  return String(input || '')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2f;/gi, '/')
}

export function normalizeYeahPromosPromoUrl(raw: string | null | undefined): string | null {
  const decoded = normalizeUrl(decodeHtmlEntitiesForUrl(String(raw || '')))
  if (!decoded) return null

  try {
    if (/^https?:\/\//i.test(decoded)) {
      return normalizeUrl(decoded)
    }
    if (decoded.startsWith('/')) {
      return normalizeUrl(new URL(decoded, 'https://yeahpromos.com').toString())
    }
  } catch {
    return null
  }

  return null
}

export function extractYeahPromosPromoLinkFromText(
  rawText: string | null | undefined
): string | null {
  const text = decodeHtmlEntitiesForUrl(String(rawText || ''))
  if (!text) return null

  const patterns: RegExp[] = [
    /ClipboardJS\.copy\(\s*(['"`])([^'"`]+)\1\s*\)/i,
    /copy\(\s*(['"`])([^'"`]+)\1\s*\)/i,
    /(['"`])((?:https?:\/\/|\/index\/index\/openurl(?:product)?\?)[^'"`\s<>]+)\1/i,
    /(https?:\/\/yeahpromos\.com\/index\/index\/openurl(?:product)?\?[^'"`\s<>]+)/i,
    /(\/index\/index\/openurl(?:product)?\?[^'"`\s<>]+)/i,
    /(https?:\/\/[^'"`\s<>]+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    const candidate = match?.[2] || match?.[1]
    const normalized = normalizeYeahPromosPromoUrl(candidate)
    if (normalized) return normalized
  }

  return null
}

export function resolveYeahPromosPromoLinkFromCard(params: {
  candidateTexts: Array<string | null | undefined>
  cardHtml: string
}): string | null {
  for (const candidateText of params.candidateTexts) {
    const extracted = extractYeahPromosPromoLinkFromText(candidateText)
    if (extracted) return extracted
  }

  const cardHtml = decodeHtmlEntitiesForUrl(params.cardHtml || '')
  if (!cardHtml) return null

  const absoluteMatches = cardHtml.match(/https?:\/\/[^'"`\s<>]+/gi) || []
  for (const candidate of absoluteMatches) {
    if (!YEAHPROMOS_PROMO_PATH_PATTERN.test(candidate)) continue
    const normalized = normalizeYeahPromosPromoUrl(candidate)
    if (normalized) return normalized
  }

  const relativeMatches = cardHtml.match(/\/index\/index\/openurl(?:product)?\?[^'"`\s<>]+/gi) || []
  for (const candidate of relativeMatches) {
    const normalized = normalizeYeahPromosPromoUrl(candidate)
    if (normalized) return normalized
  }

  return null
}

export function resolveYeahPromosProductMid(input: {
  pid: string | null
  applyProductId: string | null
  track: string | null
  asin: string | null
}): string | null {
  if (input.pid) return `pid_${input.pid}`
  if (input.applyProductId) return `product_${input.applyProductId}`
  if (input.asin) return `asin_${input.asin}`
  if (input.track) return `track_${input.track}`
  return null
}

export function parseYeahPromosProductHtmlPage(
  html: string,
  context?: {
    marketplace?: string | null
    country?: string | null
  }
): YeahPromosProductPageParseResult {
  const $ = loadHtml(html)
  const selectedMarketplaceCode = normalizeProxyCountryCode(
    String(
      context?.country ||
        resolveYeahPromosMarketplaceCountry(
          normalizeYeahPromosMarketplace(context?.marketplace || '')
        ) ||
        $('select[name="market_place"] option:selected').attr('value') ||
        ''
    )
  )
  const noProductsFound = /No products found/i.test($.text())
  const pageNowText = normalizeUrl($('#pageList .page-num').first().text())
  const pageNowMatch = pageNowText?.match(/Page\s+(\d+)/i)
  const parsedPageNow = pageNowMatch?.[1] ? parseInteger(pageNowMatch[1], NaN) : null

  const nextPageHref = $('#pageList .pager li').last().find('a').attr('href')
  const parsedNextPage = extractYeahPromosPageNumberFromHref(nextPageHref)
  const nextPage =
    parsedNextPage && (!parsedPageNow || parsedNextPage > parsedPageNow) ? parsedNextPage : null

  const items: NormalizedAffiliateProduct[] = []
  for (const element of $('.adv-block .adv-content').toArray()) {
    const block = $(element)
    const body = block.find('.adv-main').first()
    if (!body.length) continue

    const productName = normalizeUrl(body.find('.adv-name').first().text())
    const asin = normalizeAsin(body.find('span').first().text())
    const brand = normalizeUrl(body.find('.col-xs-7 a').first().text())
    const priceText = normalizeUrl(
      body.find('.color-1136').first().text() ||
        body.find('.col-xs-8 [class*="color"]').first().text() ||
        body.find('.col-xs-8 .price').first().text() ||
        body.find('.col-xs-8 .adv-price').first().text() ||
        body.find('.col-xs-8 div').first().text()
    )
    const commissionText = normalizeUrl(
      body.find('.row').first().find('.col-xs-4 div').first().text()
    )
    const ratingPanel = body.find('.rating-panel').first()
    const reviewCount = parseReviewCount(ratingPanel.text())
    const joinStatus = normalizeUrl(block.find('.status-joined').first().text())
    const applyProductId = normalizeUrl(body.find('.apply-product').first().attr('data-product_id'))
    const promoLink = resolveYeahPromosPromoLinkFromCard({
      candidateTexts: [
        body.find('.adv-btn[onclick*="ClipboardJS.copy"]').first().attr('onclick'),
        body.find('.adv-btn[onclick*="copy"]').first().attr('onclick'),
        body.find('.adv-btn[data-clipboard-text]').first().attr('data-clipboard-text'),
        body.find('[data-clipboard-text]').first().attr('data-clipboard-text'),
        body.find('[data-copy-url]').first().attr('data-copy-url'),
        body.find('a[href*="/index/index/openurlproduct"]').first().attr('href'),
        body.find('a[href*="/index/index/openurl"]').first().attr('href'),
      ],
      cardHtml: block.html() || '',
    })
    const promoMeta = resolveYeahPromosPromoIdentifiers(promoLink)

    const mid = resolveYeahPromosProductMid({
      pid: promoMeta.pid,
      applyProductId,
      track: promoMeta.track,
      asin,
    })
    if (!mid) continue

    const priceAmount = parsePriceAmount(priceText)
    const priceCurrency =
      normalizeCurrencyUnit(String(priceText || '').split(/\s+/g)[0]) ||
      extractCurrencyUnitFromText(priceText)
    const commissionRate = parsePercentage(commissionText)
    const commissionAmount = computeCommissionAmount(priceAmount, commissionRate)
    const allowedCountries = selectedMarketplaceCode ? [selectedMarketplaceCode] : []
    const isConfirmedInvalid = resolveConfirmedInvalidFromSignals({
      advertStatus: null,
      status: null,
      availability: null,
      stockStatus: null,
      joinStatus,
      isAvailable: null,
      inStock: null,
      isOos: null,
    })

    items.push({
      platform: 'yeahpromos',
      mid,
      asin,
      brand,
      productName,
      productUrl: null,
      promoLink,
      shortPromoLink: null,
      allowedCountries,
      priceAmount,
      priceCurrency,
      commissionRate,
      commissionAmount,
      commissionRateMode: 'percent',
      reviewCount,
      isDeepLink: null,
      isConfirmedInvalid,
    })
  }

  return {
    items,
    pageNow: Number.isFinite(parsedPageNow as number) ? (parsedPageNow as number) : null,
    nextPage,
    noProductsFound,
  }
}

export async function fetchYeahPromosProductsHtmlPageWithPlaywright(params: {
  pageUrl: string
  sessionCookie: string
  proxyProviderUrl: string
  country: string
}): Promise<string> {
  const { chromium } = await import('playwright')
  const proxy = await fetchProxyIp(params.proxyProviderUrl, 3, false)
  // 每次使用不同的浏览器指纹，避免被识别为同一客户端
  const fingerprint = generateRandomFingerprint()
  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: `http://${proxy.host}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password,
    },
    args: ['--disable-http2', '--disable-quic', '--no-sandbox'],
    timeout: 60000,
  })

  try {
    const context = await browser.newContext({
      userAgent: fingerprint.userAgent,
      locale: fingerprint.language,
      extraHTTPHeaders: {
        Cookie: params.sessionCookie,
        Accept: fingerprint.accept,
        'Accept-Language': fingerprint.acceptLanguage,
      },
    })
    const page = await context.newPage()
    await page.goto(params.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const html = await page.content()
    const redirectedUrl = normalizeUrl(page.url()) || ''
    const isLoginRedirect =
      redirectedUrl.includes('/index/login/login') ||
      redirectedUrl.includes('/index/index/login') ||
      /action=\"\/index\/login\/login\"/i.test(html)
    if (isLoginRedirect) {
      throw new Error('YeahPromos 登录态已失效，请先在 /products 执行 YP 登录态采集')
    }
    return html
  } finally {
    await browser.close().catch(() => {})
  }
}

export async function fetchYeahPromosProductsHtmlPage(params: {
  template: YeahPromosMarketplaceTemplate
  page: number
  sessionCookie: string
  rateLimitRetryOptions: YeahPromosRequestRateLimitOptions
  proxyProviderUrl: string
}): Promise<YeahPromosProductPageParseResult> {
  const pageUrl = buildYeahPromosProductsPageUrl(params.template.url, params.page)

  let attempt = 0
  const resolveRetryDelayMs = (retryAttempt: number, message: string): number => {
    const backoffDelayMs = calculateExponentialBackoffDelay(
      retryAttempt,
      params.rateLimitRetryOptions.baseDelayMs,
      params.rateLimitRetryOptions.maxDelayMs
    )
    if (!isYeahPromosRequestTooFastMessage(message)) {
      return backoffDelayMs
    }

    const minDelayForTooFastMs = Math.min(
      params.rateLimitRetryOptions.maxDelayMs,
      5000 * retryAttempt
    )
    return Math.max(backoffDelayMs, minDelayForTooFastMs)
  }

  while (true) {
    let response: import('axios').AxiosResponse<string>
    try {
      const agent = await createYeahPromosProxyAgent({
        proxyProviderUrl: params.proxyProviderUrl,
        country: params.template.country,
        reason: `http:page=${params.page},attempt=${attempt + 1}`,
      })
      // 每次重试使用不同的浏览器指纹，避免被识别为同一客户端
      const fingerprint = generateRandomFingerprint()

      // 构建完整的 HTTP 头部（参考 browser-stealth.ts）
      const headers: Record<string, string> = {
        Cookie: params.sessionCookie,
        Accept: fingerprint.accept,
        'Accept-Language': fingerprint.acceptLanguage,
        'Accept-Encoding': fingerprint.acceptEncoding!,
        'User-Agent': fingerprint.userAgent,
        Connection: fingerprint.connection!,
        'Upgrade-Insecure-Requests': fingerprint.upgradeInsecureRequests!,
        'Sec-Fetch-Dest': fingerprint.secFetchDest!,
        'Sec-Fetch-Mode': fingerprint.secFetchMode!,
        'Sec-Fetch-Site': fingerprint.secFetchSite!,
        'Sec-Fetch-User': fingerprint.secFetchUser!,
        'Cache-Control': fingerprint.cacheControl!,
        DNT: fingerprint.dnt!,
      }

      // 只有 Chrome/Edge 才发送 Sec-CH-UA 头部
      if (fingerprint.secChUa) {
        headers['Sec-CH-UA'] = fingerprint.secChUa
        headers['Sec-CH-UA-Mobile'] = fingerprint.secChUaMobile!
        headers['Sec-CH-UA-Platform'] = fingerprint.secChUaPlatform!
      }

      response = await axios.get(pageUrl, {
        headers,
        httpsAgent: agent,
        httpAgent: agent,
        maxRedirects: 5,
        validateStatus: () => true,
        responseType: 'text',
        timeout: 60000,
      })
    } catch (error: any) {
      const message = String(error?.message || '网络请求失败')
      const isTransient = isTransientNetworkErrorMessage(message)
      if (isTransient && attempt < params.rateLimitRetryOptions.maxRetries) {
        attempt += 1
        const delayMs = resolveRetryDelayMs(attempt, message)
        console.warn(
          `[yeahpromos] transient network(scope=${params.template.scope}, page=${params.page}), retry ${attempt}/${params.rateLimitRetryOptions.maxRetries} after ${delayMs}ms`
        )
        await sleep(delayMs)
        continue
      }
      throw error
    }

    const html = typeof response.data === 'string' ? response.data : ''
    const snippet = html.replace(/\s+/g, ' ').trim().slice(0, 220)

    const redirectedUrl = normalizeUrl(response.request?.res?.responseUrl) || ''
    const isLoginRedirect =
      redirectedUrl.includes('/index/login/login') ||
      redirectedUrl.includes('/index/index/login') ||
      /action=\"\/index\/login\/login\"/i.test(html)
    if (isLoginRedirect) {
      throw new Error('YeahPromos 登录态已失效，请先在 /products 执行 YP 登录态采集')
    }

    const isOk = response.status >= 200 && response.status < 300
    const interceptCheck = detectYeahPromosHttpIntercept({
      status: response.status,
      html,
    })

    const shouldTryPlaywright =
      response.status === 403 || response.status === 429 || (isOk && interceptCheck.blocked)
    if (shouldTryPlaywright) {
      try {
        const playwrightHtml = await fetchYeahPromosProductsHtmlPageWithPlaywright({
          pageUrl,
          sessionCookie: params.sessionCookie,
          proxyProviderUrl: params.proxyProviderUrl,
          country: params.template.country,
        })
        return parseYeahPromosProductHtmlPage(playwrightHtml, {
          marketplace: params.template.marketplace,
          country: params.template.country,
        })
      } catch (playwrightError: any) {
        const message = String(playwrightError?.message || playwrightError)
        if (attempt < params.rateLimitRetryOptions.maxRetries) {
          attempt += 1
          const delayMs = resolveRetryDelayMs(attempt, message)
          console.warn(
            `[yeahpromos] playwright fallback failed(scope=${params.template.scope}, page=${params.page}), retry ${attempt}/${params.rateLimitRetryOptions.maxRetries} after ${delayMs}ms`
          )
          await sleep(delayMs)
          continue
        }
        throw new Error(
          `YeahPromos 产品页 Playwright 回退失败(scope=${params.template.scope}, page=${params.page}): ${message}`
        )
      }
    }

    if (!isOk) {
      const failureMessage = `YeahPromos 产品页拉取失败(scope=${params.template.scope}, page=${params.page}, status=${response.status}): ${snippet || '请求失败'}`
      if (
        isTransientHttpStatus(response.status) &&
        attempt < params.rateLimitRetryOptions.maxRetries
      ) {
        attempt += 1
        const delayMs = resolveRetryDelayMs(attempt, failureMessage)
        console.warn(
          `[yeahpromos] transient http(scope=${params.template.scope}, page=${params.page}), retry ${attempt}/${params.rateLimitRetryOptions.maxRetries} after ${delayMs}ms`
        )
        await sleep(delayMs)
        continue
      }
      throw new Error(failureMessage)
    }

    if (interceptCheck.blocked) {
      const message = `YeahPromos 产品页疑似风控(scope=${params.template.scope}, page=${params.page}, reason=${interceptCheck.reason || 'unknown'})`
      if (attempt < params.rateLimitRetryOptions.maxRetries) {
        attempt += 1
        const delayMs = resolveRetryDelayMs(attempt, message)
        console.warn(
          `[yeahpromos] intercept(scope=${params.template.scope}, page=${params.page}), retry ${attempt}/${params.rateLimitRetryOptions.maxRetries} after ${delayMs}ms`
        )
        await sleep(delayMs)
        continue
      }
      throw new Error(message)
    }

    return parseYeahPromosProductHtmlPage(html, {
      marketplace: params.template.marketplace,
      country: params.template.country,
    })
  }
}

export function resolveYeahPromosSyncSessionMinRemainingMs(params: {
  startPage?: number
  startScope?: string
}): number {
  const startPage = Number(params.startPage || 0)
  const hasStartScope = String(params.startScope || '').trim().length > 0
  const isResumeWindow = startPage > 1 || hasStartScope
  return isResumeWindow ? YP_SESSION_MIN_REMAINING_MS_RESUME : YP_SESSION_MIN_REMAINING_MS_INITIAL
}

export function resolveYeahPromosConsecutiveFailureStrategy(params: {
  skipFailedPages: boolean
  fetchedItemsInWindow: number
  fetchedItemsBeforeWindow?: number
}): 'skip-page' | 'fail-sync' {
  const fetchedItemsBeforeWindow = Number(params.fetchedItemsBeforeWindow || 0)
  const hasProgressInRun = params.fetchedItemsInWindow > 0 || fetchedItemsBeforeWindow > 0
  if (!params.skipFailedPages) return 'fail-sync'
  if (!hasProgressInRun) return 'fail-sync'
  return 'skip-page'
}

export async function fetchYeahPromosPromotableProductsWithMeta(params: {
  userId: number
  startPage?: number
  startScope?: string
  fetchedItemsBeforeWindow?: number
  maxPages?: number
  suppressMaxPagesWarning?: boolean
  templatesOverride?: YeahPromosMarketplaceTemplate[]
  scopePageBudgets?: Record<string, number>
  fetchStores?: boolean
  refreshAccessProductsBaseline?: boolean
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<YeahPromosProductsFetchResult> {
  const check = await checkAffiliatePlatformConfig(params.userId, 'yeahpromos')
  ensurePlatformConfigured(check, 'yeahpromos')

  const siteId = check.values.yeahpromos_site_id
  const token = check.values.yeahpromos_token
  const sessionCookie = await getYeahPromosSessionCookieForSync(params.userId)
  if (!sessionCookie) {
    throw new Error('YeahPromos 登录态缺失或已过期，请先在 /products 完成 YP 登录态采集')
  }

  const minSessionRemainingMs = resolveYeahPromosSyncSessionMinRemainingMs({
    startPage: params.startPage,
    startScope: params.startScope,
  })

  // 导入session检查函数
  const { checkYeahPromosSessionValidForSync } = await import('@/lib/affiliate/server')
  const sessionCheck = await checkYeahPromosSessionValidForSync(
    params.userId,
    minSessionRemainingMs
  )
  if (!sessionCheck.valid) {
    const remainingMinutes = sessionCheck.remainingMs
      ? Math.floor(sessionCheck.remainingMs / 60000)
      : 0
    const requiredMinutes = Math.floor(minSessionRemainingMs / 60000)
    throw new Error(
      sessionCheck.isExpired
        ? 'YeahPromos 登录态已过期，同步任务终止'
        : `YeahPromos 登录态即将过期（剩余 ${remainingMinutes} 分钟，当前窗口需要至少 ${requiredMinutes} 分钟），同步任务终止以避免中途失败`
    )
  }

  const templates = params.templatesOverride?.length
    ? params.templatesOverride.map((template) => ({ ...template }))
    : await loadYeahPromosMarketplaceTemplates({
        userId: params.userId,
        preloadedSettings: check.values,
      })
  const countryProxyMap = await loadYeahPromosCountryProxyMap(params.userId)

  const baselineTemplate = templates.find((item) =>
    Boolean(resolveYeahPromosProxyProviderUrl(countryProxyMap, item.country))
  )
  const shouldRefreshAccessProductsBaseline = params.refreshAccessProductsBaseline ?? true
  if (shouldRefreshAccessProductsBaseline && baselineTemplate && siteId) {
    try {
      const baselineProxyUrl = resolveYeahPromosProxyProviderUrl(
        countryProxyMap,
        baselineTemplate.country
      )
      if (baselineProxyUrl) {
        const proxyAgent = await createYeahPromosProxyAgent({
          proxyProviderUrl: baselineProxyUrl,
          country: baselineTemplate.country,
          reason: 'refresh-access-products-baseline',
        })
        await fetchYeahPromosAccessProductsCount({
          userId: params.userId,
          siteId,
          sessionCookie,
          proxyAgent,
        })
      }
    } catch (error: any) {
      console.warn(
        '[yeahpromos] failed to refresh Access Products baseline:',
        error?.message || error
      )
    }
  }

  const requestDelayMs = parseIntegerInRange(
    check.values.yeahpromos_request_delay_ms || String(DEFAULT_YP_PRODUCTS_REQUEST_DELAY_MS),
    DEFAULT_YP_PRODUCTS_REQUEST_DELAY_MS,
    MIN_YP_PRODUCTS_REQUEST_DELAY_MS,
    MAX_YP_PRODUCTS_REQUEST_DELAY_MS
  )
  const requestDelayJitterMs = parseIntegerInRange(
    String(DEFAULT_YP_PRODUCTS_DELAY_JITTER_MS),
    DEFAULT_YP_PRODUCTS_DELAY_JITTER_MS,
    0,
    MAX_YP_PRODUCTS_DELAY_JITTER_MS
  )
  const rateLimitRetryOptions: YeahPromosRequestRateLimitOptions = {
    maxRetries: parseIntegerInRange(
      check.values.yeahpromos_rate_limit_max_retries || String(DEFAULT_YP_RATE_LIMIT_MAX_RETRIES),
      DEFAULT_YP_RATE_LIMIT_MAX_RETRIES,
      0,
      10
    ),
    baseDelayMs: parseIntegerInRange(
      check.values.yeahpromos_rate_limit_base_delay_ms ||
        String(DEFAULT_YP_RATE_LIMIT_BASE_DELAY_MS),
      DEFAULT_YP_RATE_LIMIT_BASE_DELAY_MS,
      100,
      60000
    ),
    maxDelayMs: parseIntegerInRange(
      check.values.yeahpromos_rate_limit_max_delay_ms || String(DEFAULT_YP_RATE_LIMIT_MAX_DELAY_MS),
      DEFAULT_YP_RATE_LIMIT_MAX_DELAY_MS,
      500,
      120000
    ),
  }

  // 读取是否跳过连续失败的页面配置
  // 默认为 true，避免因 YeahPromos 服务器端问题导致整个同步中止
  const skipFailedPages = parseBooleanSetting(
    check.values.yeahpromos_skip_failed_pages,
    DEFAULT_YP_SKIP_FAILED_PAGES
  )

  const maxPages = resolveSyncMaxPages(params.maxPages, null, MAX_YP_SYNC_MAX_PAGES)
  const configuredStartPage = Math.max(1, parseInteger(check.values.yeahpromos_page || '1', 1))
  const storePageSize = parseIntegerInRange(check.values.yeahpromos_limit || '1000', 1000, 1, 1000)
  const scopePageBudgets = new Map<string, number>()
  if (params.scopePageBudgets) {
    for (const [scope, rawBudget] of Object.entries(params.scopePageBudgets)) {
      const normalizedScope = normalizeYeahPromosMarketplace(scope)
      const normalizedBudget = Math.max(0, Math.trunc(Number(rawBudget || 0)))
      if (!normalizedScope || normalizedBudget <= 0) continue
      scopePageBudgets.set(normalizedScope, normalizedBudget)
    }
  }
  const startScope = normalizeYeahPromosMarketplace(params.startScope || '')
  const shouldFetchStores =
    params.fetchStores ??
    (!startScope &&
      Math.max(1, parseInteger(params.startPage, startScope ? 1 : configuredStartPage)) <= 1)
  const resolvedStartScopeIndex = startScope
    ? templates.findIndex((item) => item.scope === startScope)
    : 0
  let scopeIndex = resolvedStartScopeIndex >= 0 ? resolvedStartScopeIndex : 0
  let page = Math.max(1, parseInteger(params.startPage, startScope ? 1 : configuredStartPage))
  let fetchedPages = 0
  let consecutiveScopeFailureCount = 0
  let consecutiveEmptyPagesInScope = 0 // 当前市场连续空页面计数
  const fetchedPagesByScope = new Map<string, number>()
  const fetchedItemsBeforeWindow = Math.max(0, Number(params.fetchedItemsBeforeWindow || 0) || 0)

  const items: NormalizedAffiliateProduct[] = []
  let lastFetchProgressCount = 0

  const emitFetchProgress = async (force: boolean = false): Promise<void> => {
    if (!params.onFetchProgress) return
    if (!force && items.length === lastFetchProgressCount) return
    lastFetchProgressCount = items.length
    try {
      await params.onFetchProgress(items.length)
    } catch (error: any) {
      console.warn('[yeahpromos] onFetchProgress callback failed:', error?.message || error)
    }
  }

  while (scopeIndex < templates.length && (maxPages === null || fetchedPages < maxPages)) {
    const currentTemplate = templates[scopeIndex]
    const currentPage = page
    const proxyProviderUrl = resolveYeahPromosProxyProviderUrl(
      countryProxyMap,
      currentTemplate.country
    )

    if (!proxyProviderUrl) {
      console.warn(
        `[yeahpromos] skip scope=${currentTemplate.scope}: missing proxy for country=${currentTemplate.country}`
      )
      scopeIndex += 1
      page = 1
      consecutiveScopeFailureCount = 0
      consecutiveEmptyPagesInScope = 0
      continue
    }

    try {
      const parsed = await fetchYeahPromosProductsHtmlPage({
        template: currentTemplate,
        page: currentPage,
        sessionCookie,
        rateLimitRetryOptions,
        proxyProviderUrl,
      })
      items.push(...parsed.items)
      fetchedPages += 1
      const currentScopeFetchedPages = (fetchedPagesByScope.get(currentTemplate.scope) || 0) + 1
      fetchedPagesByScope.set(currentTemplate.scope, currentScopeFetchedPages)

      // 检查本页是否返回了商品
      const pageHasItems = parsed.items.length > 0

      if (!pageHasItems) {
        consecutiveEmptyPagesInScope += 1
        console.log(
          `[yeahpromos] scope=${currentTemplate.scope} page=${currentPage} returned empty (${consecutiveEmptyPagesInScope}/${MAX_YP_CONSECUTIVE_EMPTY_PAGES_PER_SCOPE})`
        )
      } else {
        consecutiveEmptyPagesInScope = 0
      }

      const parsedNextPage = parsed.nextPage
      const hasNextPage =
        Number.isFinite(parsedNextPage as number) && (parsedNextPage as number) > currentPage
      const scopePageBudget = scopePageBudgets.get(currentTemplate.scope)
      const scopeBudgetReached =
        scopePageBudget !== undefined && currentScopeFetchedPages >= scopePageBudget

      // 切换市场的条件：
      // 1. 页面明确标记没有商品且返回空列表
      // 2. 连续多页返回空列表（避免在已抓完的市场无限翻页）
      // 3. 页面没有下一页链接
      const shouldSwitchScope =
        scopeBudgetReached ||
        (parsed.noProductsFound && parsed.items.length === 0) ||
        consecutiveEmptyPagesInScope >= MAX_YP_CONSECUTIVE_EMPTY_PAGES_PER_SCOPE ||
        !hasNextPage

      if (shouldSwitchScope) {
        if (scopeBudgetReached) {
          console.log(
            `[yeahpromos] switching from scope=${currentTemplate.scope} to next scope: reached delta page budget ${scopePageBudget}`
          )
        }
        if (consecutiveEmptyPagesInScope >= MAX_YP_CONSECUTIVE_EMPTY_PAGES_PER_SCOPE) {
          console.log(
            `[yeahpromos] switching from scope=${currentTemplate.scope} to next scope: ${consecutiveEmptyPagesInScope} consecutive empty pages`
          )
        }
        scopeIndex += 1
        page = 1
        consecutiveScopeFailureCount = 0
        consecutiveEmptyPagesInScope = 0
      } else {
        page = parsedNextPage as number
        consecutiveScopeFailureCount = 0
      }
    } catch (error: any) {
      fetchedPages += 1
      consecutiveScopeFailureCount += 1
      console.warn(
        `[yeahpromos] skip failed page scope=${currentTemplate.scope}, page=${currentPage}: ${error?.message || error}`
      )
      if (consecutiveScopeFailureCount >= MAX_YP_EMPTY_PAGE_STREAK) {
        const reason = error?.message || error

        if (
          resolveYeahPromosConsecutiveFailureStrategy({
            skipFailedPages,
            fetchedItemsInWindow: items.length,
            fetchedItemsBeforeWindow,
          }) === 'skip-page'
        ) {
          // 跳过当前页面，继续下一页，避免因服务器端问题导致整个同步中止
          console.warn(
            `[yeahpromos] 连续失败 ${consecutiveScopeFailureCount} 次，跳过当前页面继续同步 (scope=${currentTemplate.scope}, page=${currentPage})`
          )
          page = currentPage + 1
          consecutiveScopeFailureCount = 0
        } else {
          const noItemsFetchedYet = items.length === 0 && fetchedItemsBeforeWindow <= 0
          const noItemsWarning =
            noItemsFetchedYet && skipFailedPages ? '当前窗口尚未抓到任何商品，不允许静默跳页；' : ''
          // 避免静默跳过整个 scope 导致”completed 但漏抓大量页面”。
          // 连续失败达到阈值时直接抛错，让任务进入 failed 并由续跑逻辑从当前 cursor 重试。
          throw new Error(
            `YeahPromos scope=${currentTemplate.scope} page=${currentPage} 连续失败 ${consecutiveScopeFailureCount} 次，${noItemsWarning}已中止同步以避免漏抓。最后错误: ${reason}`
          )
        }
      } else {
        // 失败时保持当前页，下一轮更换代理后重试同一页，避免跳页漏抓。
        page = currentPage
      }
    }

    const hasMoreCandidates = scopeIndex < templates.length
    if (fetchedPages === 1 || fetchedPages % 3 === 0 || !hasMoreCandidates) {
      await emitFetchProgress()
    }

    if (hasMoreCandidates && (maxPages === null || fetchedPages < maxPages)) {
      const jitterMs =
        requestDelayJitterMs > 0 ? randomIntInRange(-requestDelayJitterMs, requestDelayJitterMs) : 0
      const effectiveDelayMs = Math.max(0, requestDelayMs + jitterMs)
      if (effectiveDelayMs > 0) {
        await sleep(effectiveDelayMs)
      }
    }
  }

  const hasMore = scopeIndex < templates.length
  const nextScope = hasMore ? templates[scopeIndex]?.scope || null : null
  const nextPage = hasMore ? Math.max(1, page) : 0

  if (maxPages !== null && hasMore && fetchedPages >= maxPages && !params.suppressMaxPagesWarning) {
    console.warn(`[yeahpromos] reached page limit (${maxPages}); product results may be truncated`)
  }

  if (shouldFetchStores && token && siteId) {
    try {
      const storeItems = await fetchYeahPromosPromotableStores({
        token,
        siteId,
        pageSize: storePageSize,
        requestDelayMs,
        rateLimitRetryOptions,
        onFetchProgress: async (fetchedStoreCount) => {
          if (!params.onFetchProgress) return
          await params.onFetchProgress(items.length + fetchedStoreCount)
        },
      })
      items.push(...storeItems)
    } catch (error: any) {
      // 店铺信息拉取失败不应中断商品同步主流程
      console.warn('[yeahpromos] failed to fetch store merchants:', error?.message || error)
    }
  }

  await emitFetchProgress(true)

  return {
    items,
    hasMore,
    nextPage,
    nextScope,
    fetchedPages,
  }
}

export async function fetchYeahPromosPromotableProducts(params: {
  userId: number
  startPage?: number
  startScope?: string
  maxPages?: number
  suppressMaxPagesWarning?: boolean
  templatesOverride?: YeahPromosMarketplaceTemplate[]
  scopePageBudgets?: Record<string, number>
  fetchStores?: boolean
  refreshAccessProductsBaseline?: boolean
  onFetchProgress?: (fetchedCount: number) => Promise<void> | void
}): Promise<NormalizedAffiliateProduct[]> {
  const result = await fetchYeahPromosPromotableProductsWithMeta(params)
  return result.items
}
