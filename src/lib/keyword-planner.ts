/**
 * Google Ads Keyword Planner API Service
 * 获取真实的关键词搜索量数据
 */
import { GoogleAdsApi, enums } from './google-ads-api'
import { getDatabase } from './db'
import { boolCondition, dateMinusDays } from './db-helpers'
import { getCachedKeywordVolume, cacheKeywordVolume, getBatchCachedVolumes, batchCacheVolumes } from './redis'
import { decrypt } from './crypto'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'
import { refreshAccessToken, getGoogleAdsCredentials } from './google-ads-oauth'
import { getGoogleAdsLanguageIdString, getGoogleAdsGeoTargetId, normalizeCountryCode, normalizeLanguageCode } from './language-country-codes'
import { getGoogleAdsClient, getCustomerWithCredentials } from './google-ads-api'
import { getServiceAccountConfig, AuthType } from './google-ads-service-account'

/**
 * 🔧 修复(2025-12-24): 获取 KeywordPlanIdeaService
 * OAuth 模式使用 customer.keywordPlanIdeas
 * 服务账号模式使用 customer.loadService('KeywordPlanIdeaServiceClient')
 */
function getKeywordPlanIdeaService(customer: any, authType: AuthType | undefined) {
  if (authType === 'service_account') {
    // 服务账号模式：使用 loadService 动态加载服务
    // 注意：@htdangkhoa/google-ads 库的服务名需要加上 Client 后缀
    return customer.loadService('KeywordPlanIdeaServiceClient')
  } else {
    // OAuth 模式：直接访问 keywordPlanIdeas 属性
    return customer.keywordPlanIdeas
  }
}

interface KeywordVolume {
  keyword: string
  avgMonthlySearches: number
  competition: string
  competitionIndex: number
  lowTopPageBid: number
  highTopPageBid: number
  /** 搜索量数据是否可用（如 developer token 无 Basic/Standard access 时不可用） */
  volumeUnavailableReason?: 'DEV_TOKEN_INSUFFICIENT_ACCESS'
  requestedCountry?: string
  effectiveCountry?: string
  usedProxyGeo?: boolean
  requestedLanguage?: string
  effectiveLanguage?: string
  usedFallbackLanguage?: boolean
}

interface KeywordPlannerConfig {
  clientId: string
  clientSecret: string
  developerToken: string
  refreshToken?: string  // OAuth模式需要
  loginCustomerId?: string  // OAuth模式需要
  customerId: string
  // 服务账号认证
  authType?: AuthType
  serviceAccountId?: string
}

type InvalidPlannerField = 'geo_target_constants' | 'language'

function getInvalidPlannerFieldsFromGoogleAdsError(error: any): Set<InvalidPlannerField> {
  const fields = new Set<InvalidPlannerField>()
  const errors = error?.errors
  if (!Array.isArray(errors)) return fields

  for (const e of errors) {
    const location = e?.location
    const elements =
      location?.field_path_elements ||
      location?.fieldPathElements ||
      location?._field_path_elements ||
      location?._fieldPathElements

    if (!Array.isArray(elements)) continue
    for (const el of elements) {
      const fieldName = el?.field_name || el?.fieldName || el?._field_name || el?._fieldName
      if (fieldName === 'geo_target_constants') fields.add('geo_target_constants')
      if (fieldName === 'language') fields.add('language')
    }
  }

  return fields
}

function getGoogleAdsErrorMessage(error: any): string {
  return (
    error?.errors?.[0]?.message ||
    error?.error?.message ||
    error?.message ||
    (typeof error === 'string' ? error : '')
  )
}

function isDeveloperTokenTestOnlyAccessError(error: any): boolean {
  const msg = getGoogleAdsErrorMessage(error).toLowerCase()
  return (
    msg.includes('developer token is only approved for use with test accounts') ||
    (msg.includes('apply for basic') && msg.includes('standard access'))
  )
}

function isInvalidGrantMessage(message: string): boolean {
  const msg = message.toLowerCase()
  return msg.includes('invalid_grant') || msg.includes('token has been expired or revoked')
}


// Helper: Read user configs from system_settings
async function readUserConfigs(db: any, userId: number): Promise<Record<string, string>> {
  const configs = await db.query(`
    SELECT key, value, encrypted_value
    FROM system_settings
    WHERE category = 'google_ads' AND user_id = ?
  `, [userId]) as Array<{ key: string; value: string | null; encrypted_value: string | null }>

  const configMap: Record<string, string> = {}
  for (const c of configs) {
    if (c.encrypted_value) {
      const decrypted = decrypt(c.encrypted_value)
      if (decrypted) configMap[c.key] = decrypted
    } else if (c.value) {
      configMap[c.key] = c.value
    }
  }
  return configMap
}

// Helper: Get refresh_token from google_ads_credentials table
async function getUserRefreshToken(db: any, userId: number): Promise<string> {
  const isActiveCondition = boolCondition('is_active', true, db.type)
  const credentials = await db.queryOne(`
    SELECT refresh_token
    FROM google_ads_credentials
    WHERE user_id = ? AND ${isActiveCondition}
  `, [userId]) as { refresh_token: string } | undefined

  return credentials?.refresh_token || ''
}

// Helper: Get customer_id from google_ads_accounts table
// 🔧 优化(2025-12-17): 优先选择余额最高的账号，确保Keyword Planner API可用
// 只选择状态为ENABLED且非Manager账号的客户账号
async function getUserCustomerId(db: any, userId: number): Promise<string> {
  const isActiveCondition = boolCondition('is_active', true, db.type)
  const isNotManagerCondition = boolCondition('is_manager_account', false, db.type)
  const account = await db.queryOne(`
    SELECT customer_id, account_balance
    FROM google_ads_accounts
    WHERE user_id = ?
      AND ${isActiveCondition}
      AND status = 'ENABLED'
      AND ${isNotManagerCondition}
      AND account_balance IS NOT NULL
    ORDER BY account_balance DESC, id ASC
    LIMIT 1
  `, [userId]) as { customer_id: string; account_balance: number } | undefined

  if (account) {
    console.log(`[KeywordPlanner] Selected account ${account.customer_id} with balance ${account.account_balance / 1000000} (micros)`)
    return account.customer_id
  }

  // Fallback: some billing models don't have an account-specific balance (or it is intentionally omitted).
  // Still select an enabled non-manager account to keep Keyword Planner working.
  const fallbackOrder =
    db.type === 'postgres'
      ? 'last_sync_at DESC NULLS LAST, id ASC'
      : "CASE WHEN last_sync_at IS NULL THEN 1 ELSE 0 END, last_sync_at DESC, id ASC"

  const fallback = await db.queryOne(`
    SELECT customer_id
    FROM google_ads_accounts
    WHERE user_id = ?
      AND ${isActiveCondition}
      AND status = 'ENABLED'
      AND ${isNotManagerCondition}
    ORDER BY ${fallbackOrder}
    LIMIT 1
  `, [userId]) as { customer_id: string } | undefined

  if (fallback?.customer_id) {
    console.log(`[KeywordPlanner] Selected account ${fallback.customer_id} (no balance available)`)
  }

  return fallback?.customer_id || ''
}

// 🔧 修复(2025-12-12): 独立账号模式 - 每个用户必须配置自己的完整 OAuth 凭证
// Get Google Ads API config - supports both OAuth and Service Account authentication
export async function getGoogleAdsConfig(
  userId?: number,
  authType?: AuthType,
  serviceAccountId?: string
): Promise<KeywordPlannerConfig | null> {
  try {
    if (!userId) {
      console.error('[KeywordPlanner] userId is required for independent account mode')
      return null
    }

    const db = await getDatabase()

    // 1. 优先检查 OAuth 配置
    const userConfigs = await readUserConfigs(db, userId)
    const hasOAuth = userConfigs.client_id && userConfigs.client_secret && userConfigs.developer_token

    // 2. 如果有 OAuth 配置，优先使用 OAuth
    if (hasOAuth && authType !== 'service_account') {
      console.log(`[KeywordPlanner] Using OAuth authentication for user ${userId}`)

      // Get refresh token
      const credentials = await getGoogleAdsCredentials(userId)
      if (!credentials?.refresh_token) {
        console.error(`[KeywordPlanner] User ${userId} has no refresh token. Please authorize Google Ads API in Settings.`)
        return null
      }

      return {
        clientId: userConfigs.client_id,
        clientSecret: userConfigs.client_secret,
        developerToken: userConfigs.developer_token,
        customerId: credentials.login_customer_id,
        loginCustomerId: credentials.login_customer_id,
        refreshToken: credentials.refresh_token,
        authType: 'oauth' as const,
      }
    }

    // 3. 否则使用服务账号配置
    const serviceAccount = await getServiceAccountConfig(userId, serviceAccountId)
    if (serviceAccount) {
      console.log(`[KeywordPlanner] Using service account authentication for user ${userId}`)
      console.log(`[KeywordPlanner] MCC Customer ID: ${serviceAccount.mccCustomerId}`)

      return {
        clientId: userConfigs.client_id,
        clientSecret: userConfigs.client_secret,
        developerToken: serviceAccount.developerToken,
        customerId: serviceAccount.mccCustomerId,
        authType: 'service_account' as const,
        serviceAccountId: serviceAccount.id,
      }
    }

    console.error(`[KeywordPlanner] User ${userId} has no valid authentication method`)
    return null
  } catch (error) {
    console.error('[KeywordPlanner] Error getting config:', error)
    return null
  }
}

// 使用全局统一映射代替硬编码（来自 language-country-codes.ts）
// LANGUAGE_CODES → getGoogleAdsLanguageIdString()
// GEO_TARGETS → getGoogleAdsGeoTargetId()

/**
 * 从Google Ads Keyword Planner获取关键词搜索量
 */
export async function getKeywordSearchVolumes(
  keywords: string[],
  country: string,
  language: string,
  userId?: number,
  authType?: AuthType,
  serviceAccountId?: string,
  onProgress?: (info: { message: string; current?: number; total?: number }) => Promise<void> | void
): Promise<KeywordVolume[]> {
  if (!keywords.length) return []

  const requestedCountry = normalizeCountryCode(country)
  const requestedLanguage = normalizeLanguageCode(language)

  const DEFAULT_FALLBACK_COUNTRY = 'US'
  const DEFAULT_FALLBACK_LANGUAGE = 'en'

  let effectiveCountry = requestedCountry
  let effectiveLanguage = requestedLanguage
  let usedProxyGeo = false
  let usedFallbackLanguage = false

  let fallbackFields = new Set<InvalidPlannerField>()

  retryWithFallback: for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 0) {
      effectiveCountry = requestedCountry
      effectiveLanguage = requestedLanguage
      usedProxyGeo = false
      usedFallbackLanguage = false
    } else {
      if (fallbackFields.size === 0) break
      if (fallbackFields.has('geo_target_constants')) {
        effectiveCountry = DEFAULT_FALLBACK_COUNTRY
        usedProxyGeo = effectiveCountry !== requestedCountry
      }
      if (fallbackFields.has('language')) {
        effectiveLanguage = DEFAULT_FALLBACK_LANGUAGE
        usedFallbackLanguage = effectiveLanguage !== requestedLanguage
      }

      console.warn(
        `[KeywordPlanner] Falling back due to invalid planner params: ${Array.from(fallbackFields).join(', ')}. ` +
        `requested=${requestedCountry}/${requestedLanguage}, effective=${effectiveCountry}/${effectiveLanguage}`
      )
    }

    // 🔥 2025-12-16增强：添加详细日志显示缓存命中情况
    console.log(`[KeywordPlanner] 接收 ${keywords.length} 个关键词查询请求`)

    // 1. Check Redis cache first
    const cachedVolumes = await getBatchCachedVolumes(keywords, effectiveCountry, effectiveLanguage)
    const uncachedKeywords = keywords.filter(kw => !cachedVolumes.has(kw.toLowerCase()))
    // 🔧 重要：Redis 中 volume=0 可能来自历史错误/不可用降级，不能直接当作“命中最终值”
    // 仍然允许走 DB cache 覆盖（避免“全是0搜索量”的严重退化）。
    const zeroCachedKeywords = keywords.filter(kw => {
      const cached = cachedVolumes.get(kw.toLowerCase())
      return cached !== undefined && (cached.volume || 0) === 0
    })
    const dbLookupKeywords = [...uncachedKeywords, ...zeroCachedKeywords]

    console.log(`[KeywordPlanner] Redis缓存命中: ${cachedVolumes.size}/${keywords.length} 个关键词`)

    // If all cached, return from cache
    if (uncachedKeywords.length === 0 && zeroCachedKeywords.length === 0) {
      console.log(`[KeywordPlanner] 全部命中Redis缓存，无需API调用`)
      return keywords.map(kw => {
        const cached = cachedVolumes.get(kw.toLowerCase())
        return {
          keyword: kw,
          avgMonthlySearches: cached?.volume || 0,
          competition: cached?.competition || 'UNKNOWN',
          competitionIndex: cached?.competitionIndex || 0,
          lowTopPageBid: 0,
          highTopPageBid: 0,
          requestedCountry,
          effectiveCountry,
          usedProxyGeo,
          requestedLanguage,
          effectiveLanguage,
          usedFallbackLanguage,
        }
      })
    }

    // 2. Check global_keywords table
    const db = await getDatabase()
    const dbVolumes = new Map<string, KeywordVolume>()

    try {
      const { normalizeGoogleAdsKeyword } = await import('./google-ads-keyword-normalizer')

      const languageCandidates = Array.from(new Set([effectiveLanguage, language].filter(Boolean)))
      const langPlaceholders = languageCandidates.map(() => '?').join(',')
      const recentCutoffExpr = dateMinusDays(7, db.type)

      // 🔧 修复(2026-01-21): 使用规范化的关键词查询，解决标点符号匹配问题
      // 例如: "dr. mercola" 和 "dr mercola" 应该匹配同一条记录
      const normalizedToOriginals = new Map<string, Set<string>>() // normalized -> originals[]
      for (const original of dbLookupKeywords) {
        const normalized = normalizeGoogleAdsKeyword(original)
        if (!normalized) continue

        // 兼容历史版本：部分旧数据可能把空格也移除（如 "dr mercola" -> "drmercola"）
        // 这里同时写入两种key，确保缓存命中稳定。
        const normalizedKeys = new Set<string>([normalized])
        const compact = normalized.replace(/\s+/g, '')
        if (compact && compact !== normalized) normalizedKeys.add(compact)

        for (const key of normalizedKeys) {
          if (!normalizedToOriginals.has(key)) {
            normalizedToOriginals.set(key, new Set())
          }
          normalizedToOriginals.get(key)!.add(original)
        }
      }

      const normalizedKeywords = Array.from(normalizedToOriginals.keys())
      if (normalizedKeywords.length === 0) {
        console.log(`[KeywordPlanner] 数据库缓存命中: 0/${dbLookupKeywords.length} 个关键词`)
      } else {
        const placeholders = normalizedKeywords.map(() => '?').join(',')

        const rows = await db.query(`
          SELECT keyword, search_volume, competition_level, avg_cpc_micros
          FROM global_keywords
          WHERE keyword IN (${placeholders})
            AND country = ?
            AND language IN (${langPlaceholders})
            AND created_at > ${recentCutoffExpr}
        `, [
          ...normalizedKeywords,
          effectiveCountry,
          ...languageCandidates
        ]) as Array<{ keyword: string; search_volume: number; competition_level?: string; avg_cpc_micros?: number }>

        rows.forEach(row => {
          // 修复(2025-12-19): 从数据库读取competition_level和avg_cpc_micros
          const avgCpc = (row.avg_cpc_micros || 0) / 1_000_000
          const normalizedDbKeyword = normalizeGoogleAdsKeyword(row.keyword)
          const originals = normalizedToOriginals.get(normalizedDbKeyword)
          const targetKeywords = originals ? Array.from(originals) : [row.keyword]

          for (const originalKeyword of targetKeywords) {
            dbVolumes.set(originalKeyword.toLowerCase(), {
              keyword: originalKeyword,
              avgMonthlySearches: row.search_volume,
              competition: row.competition_level || 'UNKNOWN',
              competitionIndex: 0,
              lowTopPageBid: avgCpc,
              highTopPageBid: avgCpc,
              requestedCountry,
              effectiveCountry,
              usedProxyGeo,
              requestedLanguage,
              effectiveLanguage,
              usedFallbackLanguage,
            })
          }
        })
        console.log(`[KeywordPlanner] 数据库缓存命中: ${dbVolumes.size}/${dbLookupKeywords.length} 个关键词`)
      }
    } catch (error) {
      // Table might not exist yet or query failed
      console.error(`[KeywordPlanner] 数据库缓存查询失败:`, error instanceof Error ? error.message : String(error))
    }

    // Keywords still needing API call
    const needApiKeywords = uncachedKeywords.filter(kw => !dbVolumes.has(kw.toLowerCase()))
    console.log(`[KeywordPlanner] 需要API查询: ${needApiKeywords.length} 个关键词 (总${keywords.length} - Redis${cachedVolumes.size} - DB${dbVolumes.size})`)

    // 3. Call Keyword Planner API for remaining
    const apiVolumes = new Map<string, KeywordVolume>()

    let shouldRetry = false
    if (needApiKeywords.length > 0) {
      // 🔧 修复(2025-12-12): 独立账号模式 - 必须传递 userId
      // 支持 OAuth 和服务账号两种认证方式
      const config = await getGoogleAdsConfig(userId, authType, serviceAccountId)

      // 验证配置（根据认证类型验证不同字段）
      const isConfigValid = config?.developerToken && config?.customerId &&
        ((config.authType === 'service_account') ||
         (config.authType === 'oauth' && config?.refreshToken && config?.loginCustomerId))

      if (isConfigValid) {
        // Split keywords into batches of 20 (Google Ads API limit)
        const BATCH_SIZE = 20
        const keywordBatches: string[][] = []
        for (let i = 0; i < needApiKeywords.length; i += BATCH_SIZE) {
          keywordBatches.push(needApiKeywords.slice(i, i + BATCH_SIZE))
        }

        console.log(`[KeywordPlanner] Processing ${needApiKeywords.length} keywords in ${keywordBatches.length} batches (auth: ${config.authType || 'oauth'})`)

        // API追踪设置
        const apiStartTime = Date.now()
        let apiSuccess = false
        let apiErrorMessage: string | undefined
        let totalApiCalls = 0
        let skipCachingDueToUnavailable = false

        try {
          // 检查 Developer Token 的访问级别
          let apiAccessLevel: string | undefined
          try {
            // 首先尝试从 OAuth 凭证获取
            const credentialsRow = await db.queryOne(`
              SELECT api_access_level
              FROM google_ads_credentials
              WHERE user_id = ?
              LIMIT 1
            `, [userId]) as { api_access_level?: string } | undefined

            if (credentialsRow?.api_access_level) {
              apiAccessLevel = credentialsRow.api_access_level.toLowerCase()
            } else if (config.authType === 'service_account') {
              // 如果是服务账号模式，从服务账号表获取
              const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
              const serviceAccountRow = await db.queryOne(`
                SELECT api_access_level
                FROM google_ads_service_accounts
                WHERE user_id = ? AND ${isActiveCondition}
                LIMIT 1
              `, [userId]) as { api_access_level?: string } | undefined

              if (serviceAccountRow?.api_access_level) {
                apiAccessLevel = serviceAccountRow.api_access_level.toLowerCase()
              }
            }
          } catch (error) {
            console.error('[KeywordPlanner] Failed to fetch api_access_level:', error)
          }

          // Test 权限无法使用 Keyword Planner API，直接进入 no-volume 降级。
          // 注意：explorer 可能是历史误标（例如实际已经升级到 Basic/Standard 但库内未回填），
          // 因此 explorer 不在此处硬拦截，而是继续做一次真实 Historical Metrics 探测。
          if (apiAccessLevel === 'test') {
            console.warn('[KeywordPlanner] Developer Token 访问级别为 test，无法使用 Keyword Planner API')
            console.warn('[KeywordPlanner] 需要 Basic Access 或 Standard Access 权限才能获取精确搜索量数据')
            console.warn('[KeywordPlanner] 申请地址: https://developers.google.com/google-ads/api/docs/access-levels')

            // 为所有关键词返回默认值
            for (const keyword of needApiKeywords) {
              apiVolumes.set(keyword.toLowerCase(), {
                keyword: keyword,
                avgMonthlySearches: 0,
                competition: 'UNKNOWN',
                competitionIndex: 0,
                lowTopPageBid: 0,
                highTopPageBid: 0,
                volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
                requestedCountry,
                effectiveCountry,
                usedProxyGeo,
                requestedLanguage,
                effectiveLanguage,
                usedFallbackLanguage,
              })
            }

            apiSuccess = true // 标记为成功，避免记录为API错误
          } else {
            // 非 test：允许进行真实 Historical Metrics 探测（包含 basic/standard 以及 explorer 历史误标场景）
            console.log(`[KeywordPlanner] Developer Token 访问级别: ${apiAccessLevel || 'unknown'}, 认证方式: ${config.authType || 'oauth'}`)
            if (apiAccessLevel === 'explorer') {
              console.warn('[KeywordPlanner] api_access_level=explorer，先执行 Historical Metrics 实测；若权限不足再自动降级 no-volume')
            }

            // 刷新 access token 以确保有效
            try {
              await refreshAccessToken(userId || 1)
              console.log('[KeywordPlanner] Access token refreshed successfully')
            } catch (refreshError: any) {
              const refreshMessage = refreshError?.message || String(refreshError)
              if (isInvalidGrantMessage(refreshMessage)) {
                throw new Error(
                  `Google Ads OAuth 授权已过期或被撤销（invalid_grant）。` +
                  `请重新授权后再试。原始错误: ${refreshMessage}`
                )
              }
              console.warn('[KeywordPlanner] Token refresh warning:', refreshMessage)
              // 继续执行，google-ads-api 库会使用 refresh_token 自动刷新
            }

            // 🔧 修复(2025-12-26): 使用统一的 getGoogleAdsClient
            const client = getGoogleAdsClient({
              client_id: config.clientId,
              client_secret: config.clientSecret,
              developer_token: config.developerToken,
            })

            const customer = client.Customer({
              customer_id: config.customerId,
              login_customer_id: config.loginCustomerId!,
              refresh_token: config.refreshToken!,
            })

            const geoTargetId = getGoogleAdsGeoTargetId(effectiveCountry)
            const languageId = getGoogleAdsLanguageIdString(effectiveLanguage)

            // Process each batch with exponential backoff retry
            let stopProcessingBatches = false
            for (let batchIndex = 0; batchIndex < keywordBatches.length; batchIndex++) {
              const batch = keywordBatches[batchIndex]
              console.log(`[KeywordPlanner] Processing batch ${batchIndex + 1}/${keywordBatches.length} (${batch.length} keywords)`)

              let retries = 0
              const maxRetries = 3
              let success = false

              while (!success && retries <= maxRetries) {
                try {
                    // 🔧 修复(2025-12-24): 使用统一的服务访问方式
                    const keywordPlanIdeas = getKeywordPlanIdeaService(customer, config.authType)

                    // 🔧 修复(2025-12-25): 确保customer_id格式正确（去掉横杠）
                    const cleanCustomerId = config.customerId.replace(/-/g, '')

                    const requestParams = {
                      customer_id: cleanCustomerId,
                      keywords: batch,
                      language: `languageConstants/${languageId}`,
                      geo_target_constants: [`geoTargetConstants/${geoTargetId}`],
                      keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
                    }

                    console.log(`[KeywordPlanner] 🔍 请求参数: customer_id=${cleanCustomerId}, keywords=${batch.length}, authType=${config.authType}`)

                    // OAuth 模式：使用 promise-based API
                    const response = await keywordPlanIdeas.generateKeywordHistoricalMetrics(requestParams as any)

                    totalApiCalls++

                    console.log(`[KeywordPlanner] API响应类型: ${typeof response}, 结构: ${Object.keys(response || {}).join(', ')}`)
                    const results = (response as any).results || response || []
                    console.log(`[KeywordPlanner] 解析结果数量: ${Array.isArray(results) ? results.length : 'N/A'}`)

                    // 🔧 修复(2025-12-17): generateKeywordHistoricalMetrics 返回字段可能是
                    // snake_case (keyword_metrics) 或 camelCase (keywordMetrics)
                    // 或者带下划线前缀 (_keyword_metrics) - protobuf 格式
                    if (results.length > 0) {
                      console.log(`[KeywordPlanner] 首个结果结构: ${Object.keys(results[0] || {}).join(', ')}`)
                      // 🔍 调试：打印首个结果的完整内容
                      console.log(`[KeywordPlanner] 首个结果详情: ${JSON.stringify(results[0], null, 2).slice(0, 800)}`)
                    }

                    for (const result of results) {
                      // 兼容多种字段命名：snake_case, camelCase, 和 protobuf 下划线前缀
                      const text = result.text || result._text
                      const metrics = result.keyword_metrics
                        || result.keywordMetrics
                        || result._keyword_metrics
                        || result._keywordMetrics

                      if (text && metrics) {
                        // 同样兼容多种命名风格（包括 protobuf 下划线前缀）
                        const avgSearches = metrics.avg_monthly_searches
                          ?? metrics.avgMonthlySearches
                          ?? metrics._avg_monthly_searches
                          ?? 0
                        const comp = (metrics.competition ?? metrics._competition)?.toString() || 'UNKNOWN'
                        const compIndex = metrics.competition_index
                          ?? metrics.competitionIndex
                          ?? metrics._competition_index
                          ?? 0
                        const lowBid = metrics.low_top_of_page_bid_micros
                          ?? metrics.lowTopOfPageBidMicros
                          ?? metrics._low_top_of_page_bid_micros
                          ?? 0
                        const highBid = metrics.high_top_of_page_bid_micros
                          ?? metrics.highTopOfPageBidMicros
                          ?? metrics._high_top_of_page_bid_micros
                          ?? 0

                        apiVolumes.set(text.toLowerCase(), {
                          keyword: text,
                          avgMonthlySearches: Number(avgSearches) || 0,
                          competition: comp,
                          competitionIndex: Number(compIndex) || 0,
                          lowTopPageBid: Number(lowBid) / 1_000_000 || 0,
                          highTopPageBid: Number(highBid) / 1_000_000 || 0,
                          requestedCountry,
                          effectiveCountry,
                          usedProxyGeo,
                          requestedLanguage,
                          effectiveLanguage,
                          usedFallbackLanguage,
                        })
                      } else if (text) {
                        // 🔧 修复(2025-12-24): 有关键词但metrics为null时,返回0搜索量而不是丢弃关键词
                        // 原因: 长尾词或不常见关键词可能没有metrics数据,但仍需要返回给调用方
                        console.log(`[KeywordPlanner] 关键词"${text}"缺少metrics数据，返回默认值(搜索量=0)`)
                        console.log(`  - keyword_metrics: ${typeof result.keyword_metrics} = ${JSON.stringify(result.keyword_metrics)}`)
                        console.log(`  - _keyword_metrics: ${typeof result._keyword_metrics} = ${JSON.stringify(result._keyword_metrics)}`)

                        // ✅ 仍然添加到结果中,避免关键词丢失
                        apiVolumes.set(text.toLowerCase(), {
                          keyword: text,
                          avgMonthlySearches: 0,
                          competition: 'UNKNOWN',
                          competitionIndex: 0,
                          lowTopPageBid: 0,
                          highTopPageBid: 0,
                          requestedCountry,
                          effectiveCountry,
                          usedProxyGeo,
                          requestedLanguage,
                          effectiveLanguage,
                          usedFallbackLanguage,
                        })
                      }
                    }

                    success = true
                  } catch (batchError: any) {
                    if (isDeveloperTokenTestOnlyAccessError(batchError)) {
                      const msg = getGoogleAdsErrorMessage(batchError)
                      console.warn('[KeywordPlanner] Developer token 缺少 Basic/Standard access，Historical Metrics 不可用；本次返回默认搜索量=0（不写入缓存）')
                      console.warn(`[KeywordPlanner] 原因: ${msg}`)

                      for (const keyword of needApiKeywords) {
                        apiVolumes.set(keyword.toLowerCase(), {
                          keyword,
                          avgMonthlySearches: 0,
                          competition: 'UNKNOWN',
                          competitionIndex: 0,
                          lowTopPageBid: 0,
                          highTopPageBid: 0,
                          volumeUnavailableReason: 'DEV_TOKEN_INSUFFICIENT_ACCESS',
                          requestedCountry,
                          effectiveCountry,
                          usedProxyGeo,
                          requestedLanguage,
                          effectiveLanguage,
                          usedFallbackLanguage,
                        })
                      }

                      skipCachingDueToUnavailable = true
                      apiErrorMessage = msg
                      stopProcessingBatches = true
                      success = true
                      break
                    }

                    const errorMsg = batchError.errors?.[0]?.message || batchError.message || ''
                    if (isInvalidGrantMessage(errorMsg)) {
                      throw new Error(
                        `Google Ads OAuth 授权已过期或被撤销（invalid_grant）。` +
                        `请重新授权后再试。原始错误: ${errorMsg}`
                      )
                    }
                    if (errorMsg.includes('Too many requests')) {
                      retries++
                      const waitTime = Math.min(5000 * Math.pow(2, retries - 1), 30000) // 5s, 10s, 20s, max 30s
                      console.log(`[KeywordPlanner] Rate limit hit, retry ${retries}/${maxRetries} after ${waitTime}ms`)
                      await new Promise(resolve => setTimeout(resolve, waitTime))
                      continue
                    }

                    const invalidFields = getInvalidPlannerFieldsFromGoogleAdsError(batchError)
                    if (attempt === 0 && invalidFields.size > 0) {
                      fallbackFields = invalidFields
                      shouldRetry = true
                      break
                    }

                    throw batchError
                  }
                }

                if (shouldRetry) break
                if (stopProcessingBatches) break

                if (success) {
                  try {
                    await onProgress?.({
                      message: `搜索量批次 ${batchIndex + 1}/${keywordBatches.length} 完成`,
                      current: batchIndex + 1,
                      total: keywordBatches.length
                    })
                  } catch {}
                }

                // Delay between batches
                if (batchIndex < keywordBatches.length - 1) {
                  await new Promise(resolve => setTimeout(resolve, 2000))
                }
              }

            if (!shouldRetry) {
              console.log(`[KeywordPlanner] Completed ${totalApiCalls} API calls, retrieved ${apiVolumes.size} keyword volumes`)

              if (!skipCachingDueToUnavailable) {
                // Save to database and cache
                const toCache: Array<{ keyword: string; volume: number; competition?: string; competitionIndex?: number }> = []
                for (const [kw, vol] of apiVolumes) {
                  toCache.push({
                    keyword: kw,
                    volume: vol.avgMonthlySearches,
                    competition: vol.competition !== 'UNKNOWN' ? vol.competition : undefined,
                    competitionIndex: vol.competitionIndex
                  })
                  // 修复(2025-12-19): 同时保存competition_level和avg_cpc_micros
                  await saveToGlobalKeywords(
                    kw,
                    effectiveCountry,
                    effectiveLanguage,
                    vol.avgMonthlySearches,
                    vol.competition !== 'UNKNOWN' ? vol.competition : undefined,
                    Math.round((vol.lowTopPageBid + vol.highTopPageBid) / 2 * 1_000_000) || undefined
                  )
                }

                if (toCache.length) {
                  await batchCacheVolumes(toCache, effectiveCountry, effectiveLanguage)
                }

                apiSuccess = true
              } else {
                apiSuccess = false
              }
            }
          }
        } catch (error: any) {
          apiSuccess = false
          // 改进错误捕获：Google Ads API错误可能包含在不同位置
          apiErrorMessage = error.message
            || error.errors?.[0]?.message
            || error.error?.message
            || (typeof error === 'string' ? error : JSON.stringify(error))
          console.error('[KeywordPlanner] API error:', error)
          if (isInvalidGrantMessage(apiErrorMessage || '')) {
            throw error
          }
        } finally {
          // 记录API使用（仅在有userId时追踪）
          if (userId) {
            await trackApiUsage({
              userId,
              operationType: ApiOperationType.GET_KEYWORD_IDEAS, // Historical metrics use same quota
              endpoint: 'generateKeywordHistoricalMetrics',
              customerId: config.customerId,
              requestCount: totalApiCalls,
              responseTimeMs: Date.now() - apiStartTime,
              isSuccess: apiSuccess,
              errorMessage: apiErrorMessage
            })
          }
        }
      }
    }

    if (shouldRetry && attempt === 0) {
      continue retryWithFallback
    }

    // 4. Combine all results
    return keywords.map(kw => {
      const kwLower = kw.toLowerCase()

      // Check API result first
      if (apiVolumes.has(kwLower)) {
        const hit = apiVolumes.get(kwLower)!
        return { ...hit, keyword: kw }
      }

      // Then DB (now with competition data)
      if (dbVolumes.has(kwLower)) {
        const hit = dbVolumes.get(kwLower)!
        return { ...hit, keyword: kw }
      }

      // Then cache
      if (cachedVolumes.has(kwLower)) {
        const cached = cachedVolumes.get(kwLower)
        return {
          keyword: kw,
          avgMonthlySearches: cached?.volume || 0,
          competition: cached?.competition || 'UNKNOWN',
          competitionIndex: cached?.competitionIndex || 0,
          lowTopPageBid: 0,
          highTopPageBid: 0,
          requestedCountry,
          effectiveCountry,
          usedProxyGeo,
          requestedLanguage,
          effectiveLanguage,
          usedFallbackLanguage,
        }
      }

      // Default: 0
      return {
        keyword: kw,
        avgMonthlySearches: 0,
        competition: 'UNKNOWN',
        competitionIndex: 0,
        lowTopPageBid: 0,
        highTopPageBid: 0,
        requestedCountry,
        effectiveCountry,
        usedProxyGeo,
        requestedLanguage,
        effectiveLanguage,
        usedFallbackLanguage,
      }
    })
  }

  // Unreachable in practice; keep TypeScript happy.
  return []
}

/**
 * 保存到全局关键词表
 *
 * 缓存策略：
 * - created_at: 首次缓存或搜索量变化时的时间，用于7天过期判断
 * - cached_at: 最后一次API调用时间，用于记录
 * - 如果搜索量变化，重置created_at开始新的7天计时
 * - 如果搜索量未变化，保持created_at不变，确保7天后会重新从API刷新
 *
 * 修复(2025-12-19): 保存competition_level和avg_cpc_micros数据
 */
async function saveToGlobalKeywords(
  keyword: string,
  country: string,
  language: string,
  volume: number,
  competitionLevel?: string,
  avgCpcMicros?: number
): Promise<void> {
  try {
    const { normalizeGoogleAdsKeyword } = await import('./google-ads-keyword-normalizer')
    // 🔧 修复(2026-01-21): 存储规范化的关键词，解决标点符号匹配问题
    const normalizedKeyword = normalizeGoogleAdsKeyword(keyword)

    const db = await getDatabase()
    await db.exec(`
      INSERT INTO global_keywords (keyword, country, language, search_volume, competition_level, avg_cpc_micros, cached_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(keyword, country, language)
      DO UPDATE SET
        search_volume = CASE
          WHEN excluded.search_volume > 0 THEN excluded.search_volume
          WHEN COALESCE(global_keywords.search_volume, 0) > 0 THEN global_keywords.search_volume
          ELSE excluded.search_volume
        END,
        competition_level = CASE
          WHEN excluded.search_volume > 0 THEN excluded.competition_level
          WHEN COALESCE(global_keywords.search_volume, 0) > 0 THEN global_keywords.competition_level
          ELSE COALESCE(excluded.competition_level, global_keywords.competition_level)
        END,
        avg_cpc_micros = CASE
          WHEN excluded.search_volume > 0 THEN excluded.avg_cpc_micros
          WHEN COALESCE(global_keywords.search_volume, 0) > 0 THEN global_keywords.avg_cpc_micros
          ELSE COALESCE(excluded.avg_cpc_micros, global_keywords.avg_cpc_micros)
        END,
        cached_at = datetime('now'),
        created_at = CASE
          WHEN COALESCE(global_keywords.search_volume, 0) != (
            CASE
              WHEN excluded.search_volume > 0 THEN excluded.search_volume
              WHEN COALESCE(global_keywords.search_volume, 0) > 0 THEN global_keywords.search_volume
              ELSE excluded.search_volume
            END
          )
          THEN datetime('now')
          ELSE global_keywords.created_at
        END
    `, [normalizedKeyword, country, language, volume, competitionLevel || null, avgCpcMicros || null])
  } catch {
    // Table might not exist yet
  }
}

/**
 * 获取单个关键词的搜索量（带缓存）
 */
export async function getKeywordVolume(
  keyword: string,
  country: string,
  language: string
): Promise<number> {
  // Check Redis first
  const cached = await getCachedKeywordVolume(keyword, country, language)
  if (cached) return cached.volume

  // Then API
  const results = await getKeywordSearchVolumes([keyword], country, language)
  return results[0]?.avgMonthlySearches || 0
}

/**
 * 获取关键词建议（基于种子关键词）
 * 🔧 修复(2025-12-12): 独立账号模式 - 添加 userId 参数
 */
export async function getKeywordSuggestions(
  seedKeywords: string[],
  country: string,
  language: string,
  maxResults: number = 50,
  userId?: number,
  authType?: AuthType,
  serviceAccountId?: string
): Promise<KeywordVolume[]> {
  const requestedCountry = normalizeCountryCode(country)
  const requestedLanguage = normalizeLanguageCode(language)

  const DEFAULT_FALLBACK_COUNTRY = 'US'
  const DEFAULT_FALLBACK_LANGUAGE = 'en'

  let effectiveCountry = requestedCountry
  let effectiveLanguage = requestedLanguage
  let usedProxyGeo = false
  let usedFallbackLanguage = false
  let fallbackFields = new Set<InvalidPlannerField>()

  const config = await getGoogleAdsConfig(userId, authType, serviceAccountId)

  // 验证配置（根据认证类型验证不同字段）
  const isConfigValid = config?.developerToken && config?.customerId &&
    ((config.authType === 'service_account') ||
     (config.authType === 'oauth' && config?.refreshToken && config?.loginCustomerId))

  if (!isConfigValid) {
    console.warn('[KeywordPlanner] No valid config for suggestions')
    return []
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 0) {
      effectiveCountry = requestedCountry
      effectiveLanguage = requestedLanguage
      usedProxyGeo = false
      usedFallbackLanguage = false
    } else {
      if (fallbackFields.size === 0) break
      if (fallbackFields.has('geo_target_constants')) {
        effectiveCountry = DEFAULT_FALLBACK_COUNTRY
        usedProxyGeo = effectiveCountry !== requestedCountry
      }
      if (fallbackFields.has('language')) {
        effectiveLanguage = DEFAULT_FALLBACK_LANGUAGE
        usedFallbackLanguage = effectiveLanguage !== requestedLanguage
      }
      console.warn(
        `[KeywordPlanner] Falling back suggestions due to invalid planner params: ${Array.from(fallbackFields).join(', ')}. ` +
        `requested=${requestedCountry}/${requestedLanguage}, effective=${effectiveCountry}/${effectiveLanguage}`
      )
    }

    try {
      // 🔧 修复(2025-12-26): 使用统一入口 google-ads-keyword-planner
      if (config.authType === 'service_account') {
        const { getKeywordIdeas } = await import('./google-ads-keyword-planner')

        const result = await getKeywordIdeas({
          userId: userId || 1,
          customerId: config.customerId,
          seedKeywords,
          targetCountry: effectiveCountry,
          targetLanguage: effectiveLanguage,
          authType: 'service_account',
          serviceAccountId: config.serviceAccountId,
        })

        return result.slice(0, maxResults).map((idea) => ({
          keyword: idea.text,
          avgMonthlySearches: idea.avgMonthlySearches,
          competition: idea.competition,
          competitionIndex: idea.competitionIndex,
          lowTopPageBid: idea.lowTopOfPageBidMicros ? idea.lowTopOfPageBidMicros / 1000000 : 0,
          highTopPageBid: idea.highTopOfPageBidMicros ? idea.highTopOfPageBidMicros / 1000000 : 0,
          requestedCountry,
          effectiveCountry,
          usedProxyGeo,
          requestedLanguage,
          effectiveLanguage,
          usedFallbackLanguage,
        }))
      }

      // OAuth认证模式 - 使用统一的 getGoogleAdsClient
      const client = getGoogleAdsClient({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        developer_token: config.developerToken,
      })

      const customer = client.Customer({
        customer_id: config.customerId,
        login_customer_id: config.loginCustomerId!,
        refresh_token: config.refreshToken!,
      })

      const geoTargetId = getGoogleAdsGeoTargetId(effectiveCountry)
      const languageId = getGoogleAdsLanguageIdString(effectiveLanguage)

      // 🔧 修复(2025-12-24): 使用统一的服务访问方式
      const keywordPlanIdeas = getKeywordPlanIdeaService(customer, config.authType)

      const requestParams = {
        customer_id: config.customerId,
        language: `languageConstants/${languageId}`,
        geo_target_constants: [`geoTargetConstants/${geoTargetId}`],
        keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
        keyword_seed: { keywords: seedKeywords },
        include_adult_keywords: false,
        page_token: '',
        page_size: maxResults,
        keyword_annotation: [],
      }

      // 🔧 修复(2025-12-26): gRPC调用需要手动传递metadata（含developer-token）
      // 🔧 修复(2025-12-27): 添加类型断言以解决authType类型推断问题
      let response
      if ((config.authType as AuthType) === 'service_account') {
        // 从customer获取包含developer-token的metadata
        const metadata = (customer as any).callMetadata
        response = await new Promise((resolve, reject) => {
          // gRPC unary方法签名: method(request, metadata, callback)
          keywordPlanIdeas.generateKeywordIdeas(requestParams, metadata, (error: any, response: any) => {
            if (error) reject(error)
            else resolve(response)
          })
        })
      } else {
        // OAuth 模式：google-ads-api 库自动处理 developer_token
        const oauthMetadata = (customer as any).callMetadata
        if (oauthMetadata) {
          response = await keywordPlanIdeas.generateKeywordIdeas(requestParams as any, oauthMetadata)
        } else {
          response = await keywordPlanIdeas.generateKeywordIdeas(requestParams as any)
        }
      }

      const results: KeywordVolume[] = []
      const ideas = (response as any).results || response || []

      for (const idea of ideas) {
        if (results.length >= maxResults) break

        if (idea.text && idea.keyword_idea_metrics) {
          const metrics = idea.keyword_idea_metrics
          results.push({
            keyword: idea.text,
            avgMonthlySearches: Number(metrics.avg_monthly_searches) || 0,
            competition: metrics.competition?.toString() || 'UNKNOWN',
            competitionIndex: Number(metrics.competition_index) || 0,
            lowTopPageBid: Number(metrics.low_top_of_page_bid_micros) / 1_000_000 || 0,
            highTopPageBid: Number(metrics.high_top_of_page_bid_micros) / 1_000_000 || 0,
            requestedCountry,
            effectiveCountry,
            usedProxyGeo,
            requestedLanguage,
            effectiveLanguage,
            usedFallbackLanguage,
          })
        }
      }

      // Cache results
      const toCache = results.map(r => ({ keyword: r.keyword, volume: r.avgMonthlySearches }))
      if (toCache.length) {
        await batchCacheVolumes(toCache, effectiveCountry, effectiveLanguage)

        // Also save to DB
        for (const r of results) {
          await saveToGlobalKeywords(r.keyword, effectiveCountry, effectiveLanguage, r.avgMonthlySearches)
        }
      }

      return results
    } catch (error: any) {
      const invalidFields = getInvalidPlannerFieldsFromGoogleAdsError(error)
      if (attempt === 0 && invalidFields.size > 0) {
        fallbackFields = invalidFields
        continue
      }
      console.error('[KeywordPlanner] Suggestions error:', error)
      return []
    }
  }

  return []
}
