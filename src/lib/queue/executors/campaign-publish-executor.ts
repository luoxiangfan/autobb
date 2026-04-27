/**
 * 广告系列发布任务执行器
 *
 * 🚀 优化(2025-12-18)：处理长耗时的Google Ads API调用
 *   - 从同步API调用改为后台任务处理
 *   - 避免Nginx 504超时（30s限制）
 *   - 支持进度追踪和错误恢复
 *
 * 工作流程：
 * 1. 验证请求数据和权限
 * 2. 保存campaign到数据库（pending状态）
 * 3. 批量创建到Google Ads
 * 4. 更新campaign状态和Google IDs
 * 5. 处理失败情况并支持重试
 */

import type { Task } from '../types'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCredentials, getUserAuthType } from '@/lib/google-ads-oauth'
import {
  resolveLoginCustomerCandidates,
  isGoogleAdsAccountAccessError,
} from '@/lib/google-ads-login-customer'
import {
  createGoogleAdsCampaign,
  createGoogleAdsAdGroup,
  createGoogleAdsKeywordsBatch,
  createGoogleAdsResponsiveSearchAd,
  getGoogleAdsCampaign,
  updateGoogleAdsCampaignStatus,
  createGoogleAdsCalloutExtensions,
  createGoogleAdsSitelinkExtensions,
  ensureKeywordsInHeadlines,
} from '@/lib/google-ads-api'
import { setCampaignPageViewGoalWithCredentials } from '@/lib/google-ads-conversion-goals'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'
import { generateNamingScheme, type NamingScheme } from '@/lib/naming-convention'
import { invalidateOfferCache } from '@/lib/api-cache'
import { formatGoogleAdsApiError } from '@/lib/google-ads-api-error'
import { addUrlSwapTargetForOfferCampaign } from '@/lib/url-swap'
import { applyCampaignTransition } from '@/lib/campaign-state-machine'
import { backfillOfferProductLinkForPublishedCampaign } from '@/lib/affiliate-products'
import {
  normalizeNegativeKeywordMatchTypeMap,
  resolveNegativeKeywordMatchType,
} from '@/lib/campaign-publish/negative-keyword-match-type'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads-keyword-normalizer'
import {
  normalizePositiveKeywordMatchType,
  resolvePositiveKeywordMatchType,
  type PositiveKeywordMatchType,
} from '@/lib/campaign-publish/positive-keyword-match-type'
import {
  extractGoogleAdsRetryDelaySeconds,
  isGoogleAdsQuotaRateError,
} from '@/lib/google-ads-quota-error'

function describeLoginCustomerId(value: string | undefined): string {
  return value || 'null(omit)'
}

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const REQUIRED_RSA_HEADLINE_COUNT = 15
const REQUIRED_RSA_DESCRIPTION_COUNT = 4
const MIN_FORCE_PUBLISH_HEADLINE_COUNT = 3
const MIN_FORCE_PUBLISH_DESCRIPTION_COUNT = 2

function normalizeCreativeTextAssets(rawAssets: unknown): string[] {
  if (!Array.isArray(rawAssets)) return []
  return rawAssets
    .map((asset) => String(asset || '').trim())
    .filter((asset) => asset.length > 0)
}

function assertRequiredRsaAssetCounts(creative: CampaignPublishTaskData['creative']) {
  const headlineCount = normalizeCreativeTextAssets(creative?.headlines).length
  const descriptionCount = normalizeCreativeTextAssets(creative?.descriptions).length

  if (headlineCount !== REQUIRED_RSA_HEADLINE_COUNT) {
    throw new Error(
      `Headlines必须正好${REQUIRED_RSA_HEADLINE_COUNT}个，当前提供了${headlineCount}个。如果从广告创意中获得的标题数量不足，请报错。`
    )
  }

  if (descriptionCount !== REQUIRED_RSA_DESCRIPTION_COUNT) {
    throw new Error(
      `Descriptions必须正好${REQUIRED_RSA_DESCRIPTION_COUNT}个，当前提供了${descriptionCount}个。如果从广告创意中获得的描述数量不足，请报错。`
    )
  }
}

function resolvePublishRsaAssets(
  assets: string[],
  minimumCount: number,
  requiredCount: number,
  assetLabel: 'Headlines' | 'Descriptions',
  forcePublish: boolean
): string[] {
  const normalized = normalizeCreativeTextAssets(assets)

  if (!forcePublish) {
    if (normalized.length !== requiredCount) {
      throw new Error(
        `${assetLabel}必须正好${requiredCount}个，当前提供了${normalized.length}个。如果从广告创意中获得的${assetLabel === 'Headlines' ? '标题' : '描述'}数量不足，请报错。`
      )
    }
    return normalized
  }

  if (normalized.length < minimumCount) {
    throw new Error(
      `强制发布失败：${assetLabel === 'Headlines' ? `至少保留${minimumCount}个标题` : `至少保留${minimumCount}个描述`}，当前仅${normalized.length}个。`
    )
  }

  if (normalized.length >= requiredCount) {
    return normalized.slice(0, requiredCount)
  }

  const padded = [...normalized]
  for (let index = 0; padded.length < requiredCount; index += 1) {
    padded.push(normalized[index % normalized.length])
  }

  console.warn(
    `[Publish] 强制发布资产补齐: ${assetLabel} ${normalized.length} -> ${requiredCount}`
  )

  return padded
}

/**
 * 广告系列发布任务数据接口
 */
export interface CampaignPublishTaskData {
  // 基础信息
  campaignId: number              // 数据库中已创建的campaign记录ID
  offerId: number
  googleAdsAccountId: number
  userId: number

  // 命名规范
  naming?: NamingScheme  // 🔥 使用NamingScheme类型，包含associativeCampaignName

  // 配置信息
  campaignConfig: {
    targetCountry: string
    targetLanguage: string
    biddingStrategy: string
    budgetAmount: number
    budgetType: 'DAILY' | 'TOTAL'
    maxCpcBid: number
    keywords: Array<
      | string
      | {
          text?: string
          keyword?: string
          matchType?: 'EXACT' | 'PHRASE' | 'BROAD' | 'BROAD_MATCH_MODIFIER'
        }
    >
    negativeKeywords?: string[]
    // 可选：按关键词指定否定词匹配类型（优先级高于自动推断）
    negativeKeywordMatchType?: Record<string, 'EXACT' | 'PHRASE' | 'BROAD' | 'BROAD_MATCH_MODIFIER' | 'BMM'>
    // 兼容历史字段命名
    negativeKeywordsMatchType?: Record<string, 'EXACT' | 'PHRASE' | 'BROAD' | 'BROAD_MATCH_MODIFIER' | 'BMM'>
  }

  // 创意信息
  creative: {
    id?: number
    headlines: string[]
    descriptions: string[]
    finalUrl: string
    finalUrlSuffix?: string
    path1?: string
    path2?: string
    callouts?: string[]
    sitelinks?: Array<{
      text: string
      url: string
      description?: string
    }>
    keywordsWithVolume?: Array<{
      keyword: string
      matchType?: 'EXACT' | 'PHRASE' | 'BROAD'
      searchVolume?: number
    }>
  }

  // 品牌信息
  brandName: string

  // 可选标志
  forcePublish?: boolean               // 是否强制发布（允许非15/4创意）
  enableCampaignImmediately?: boolean  // 是否立即启用Campaign
  pauseOldCampaigns?: boolean          // 是否暂停旧Campaign
}

/**
 * 广告系列发布任务执行器
 */
export async function executeCampaignPublish(
  task: Task<CampaignPublishTaskData>
): Promise<{
  success: boolean
  googleCampaignId?: string
  googleAdGroupId?: string
  googleAdId?: string
  error?: string
}> {
  const safeJsonStringify = (value: unknown, space: number = 2): string => {
    const seen = new WeakSet<object>()
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'bigint') return val.toString()
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]'
          seen.add(val)
        }
        return val
      },
      space
    )
  }

  const redactSecrets = (value: unknown, depth: number = 0): unknown => {
    const MAX_DEPTH = 6
    if (depth > MAX_DEPTH) return '[Truncated]'

    const SENSITIVE_KEYS = new Set([
      'private_key',
      'privateKey',
      'developer_token',
      'developerToken',
      'refresh_token',
      'refreshToken',
      'access_token',
      'accessToken',
      'authorization',
      'cookie',
      'set-cookie',
    ])

    const redactString = (s: string): string => {
      if (s.includes('-----BEGIN PRIVATE KEY-----') || s.includes('BEGIN PRIVATE KEY')) return '[REDACTED_PRIVATE_KEY]'
      if (s.length > 6000) return `[TRUNCATED_STRING len=${s.length}]`
      return s
    }

    if (typeof value === 'string') return redactString(value)
    if (typeof value !== 'object' || value === null) return value
    if (Array.isArray(value)) return value.map(v => redactSecrets(v, depth + 1))

    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.has(k)) {
        out[k] = '[REDACTED]'
        continue
      }
      // AxiosError 常见的大字段：config.data / request / socket 等，既敏感又巨大
      if (k === 'request' || k === 'socket' || k === 'agent') {
        out[k] = '[OMITTED]'
        continue
      }
      if (k === 'data' && typeof v === 'string' && v.includes('private_key')) {
        out[k] = '[REDACTED]'
        continue
      }
      out[k] = redactSecrets(v, depth + 1)
    }
    return out
  }

  const buildErrorLogObject = (err: unknown): Record<string, unknown> => {
    // 专门处理 AxiosError：避免把 config/request 等敏感和巨大对象打到日志
    if (err && typeof err === 'object' && (err as any).isAxiosError) {
      const ax = err as any
      return redactSecrets({
        kind: 'AxiosError',
        name: ax.name,
        message: ax.message,
        code: ax.code,
        url: ax.config?.url,
        method: ax.config?.method,
        status: ax.response?.status,
        pythonRequestId: ax.response?.headers?.['x-request-id'],
        responseData: ax.response?.data,
      }) as Record<string, unknown>
    }

    if (err instanceof Error) {
      const ownProps: Record<string, unknown> = {}
      for (const key of Object.getOwnPropertyNames(err)) {
        ownProps[key] = (err as any)[key]
      }
      for (const key of Object.keys(err as any)) {
        ownProps[key] = (err as any)[key]
      }
      return redactSecrets({
        kind: 'Error',
        name: err.name,
        message: err.message,
        stack: err.stack,
        ...ownProps,
      }) as Record<string, unknown>
    }

    if (typeof err === 'object' && err !== null) {
      const ownProps: Record<string, unknown> = {}
      for (const key of Object.getOwnPropertyNames(err)) {
        ownProps[key] = (err as any)[key]
      }
      for (const key of Object.keys(err as any)) {
        ownProps[key] = (err as any)[key]
      }
      return redactSecrets({ kind: typeof err, ...ownProps }) as Record<string, unknown>
    }

    return redactSecrets({ kind: typeof err, value: err }) as Record<string, unknown>
  }

  const db = await getDatabase()
  const {
    campaignId,
    offerId,
    googleAdsAccountId,
    userId,
    campaignConfig,
    creative,
    brandName,
    forcePublish = false,
    enableCampaignImmediately = false,
    pauseOldCampaigns = false
  } = task.data

  const apiStartTime = Date.now()
  let apiSuccess = false
  let apiErrorMessage: string | undefined
  let totalApiOperations = 0
  const nowExpr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const campaignPublishHeartbeatMs = parsePositiveIntEnv(
    process.env.CAMPAIGN_PUBLISH_HEARTBEAT_MS,
    15000
  )
  const campaignPublishQuotaRetryMaxRetries = parsePositiveIntEnv(
    process.env.CAMPAIGN_PUBLISH_QUOTA_MAX_RETRIES,
    3
  )
  const campaignPublishQuotaRetryBaseDelayMs = parsePositiveIntEnv(
    process.env.CAMPAIGN_PUBLISH_QUOTA_RETRY_BASE_DELAY_MS,
    3000
  )
  const campaignPublishQuotaRetryMaxDelayMs = parsePositiveIntEnv(
    process.env.CAMPAIGN_PUBLISH_QUOTA_RETRY_MAX_DELAY_MS,
    30000
  )
  const campaignPublishStartedAt = Date.now()
  let lastHeartbeatLogAt = 0
  let lastHeartbeatStage = ''

  const touchCampaignHeartbeat = async (stage: string) => {
    await db.exec(
      `
        UPDATE campaigns
        SET updated_at = ${nowExpr}
        WHERE id = ? AND user_id = ? AND creation_status = 'pending'
      `,
      [campaignId, userId]
    )

    const now = Date.now()
    if (stage !== lastHeartbeatStage || now - lastHeartbeatLogAt >= 60000) {
      lastHeartbeatLogAt = now
      lastHeartbeatStage = stage
      const elapsedSeconds = Math.floor((now - campaignPublishStartedAt) / 1000)
      console.log(`💓 Campaign发布心跳: ${task.id} - ${stage} (${elapsedSeconds}s)`)
    }
  }

  const runWithCampaignHeartbeat = async <T>(
    stage: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    let heartbeatTimer: NodeJS.Timeout | null = null

    try {
      await touchCampaignHeartbeat(stage)
    } catch (heartbeatError: any) {
      console.warn(`⚠️ Campaign发布初始心跳更新失败: ${task.id}: ${heartbeatError?.message || heartbeatError}`)
    }

    heartbeatTimer = setInterval(() => {
      void touchCampaignHeartbeat(stage).catch((heartbeatError: any) => {
        console.warn(`⚠️ Campaign发布心跳更新失败: ${task.id}: ${heartbeatError?.message || heartbeatError}`)
      })
    }, campaignPublishHeartbeatMs)

    try {
      return await operation()
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }
  }

  const runWithGoogleAdsQuotaRetry = async <T>(
    stage: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    const totalAttempts = campaignPublishQuotaRetryMaxRetries + 1

    for (let attempt = 0; ; attempt++) {
      try {
        return await operation()
      } catch (error: any) {
        const shouldRetry =
          isGoogleAdsQuotaRateError(error)
          && attempt < campaignPublishQuotaRetryMaxRetries

        if (!shouldRetry) {
          throw error
        }

        const retryDelaySeconds = extractGoogleAdsRetryDelaySeconds(error)
        const fallbackDelayMs = Math.min(
          campaignPublishQuotaRetryBaseDelayMs * Math.pow(2, attempt),
          campaignPublishQuotaRetryMaxDelayMs
        )

        const retryDelayMs = retryDelaySeconds
          ? Math.min(
              Math.max(retryDelaySeconds * 1000, campaignPublishQuotaRetryBaseDelayMs),
              campaignPublishQuotaRetryMaxDelayMs
            )
          : fallbackDelayMs

        const retryDelayDisplaySeconds = Math.ceil(retryDelayMs / 1000)
        console.warn(
          `⚠️ ${stage} 命中Google Ads配额限流，${retryDelayDisplaySeconds}s 后重试 ` +
          `(尝试 ${attempt + 1}/${totalAttempts})`
        )

        await new Promise(resolve => setTimeout(resolve, retryDelayMs))
      }
    }
  }

  try {
    console.log(`🚀 开始执行Campaign发布任务: ${task.id}`)

    const campaignSnapshot = await db.queryOne<{
      status: string | null
      is_deleted: any
    }>(
      `
        SELECT status, is_deleted
        FROM campaigns
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [campaignId, userId]
    )

    const campaignAlreadyRemoved =
      (campaignSnapshot?.is_deleted === true || campaignSnapshot?.is_deleted === 1)
      || String(campaignSnapshot?.status || '').toUpperCase() === 'REMOVED'

    if (!campaignSnapshot || campaignAlreadyRemoved) {
      console.log(`⏭️ 跳过Campaign发布任务：campaign已下线或不存在（campaignId=${campaignId}, taskId=${task.id}）`)
      apiSuccess = true
      return { success: true }
    }

    console.log(
      `[Publish] RSA资产数量校验: headlines=${Array.isArray(creative.headlines) ? creative.headlines.length : 0}, descriptions=${Array.isArray(creative.descriptions) ? creative.descriptions.length : 0}`
    )
    if (!forcePublish) {
      assertRequiredRsaAssetCounts(creative)
    } else {
      const headlineCount = normalizeCreativeTextAssets(creative.headlines).length
      const descriptionCount = normalizeCreativeTextAssets(creative.descriptions).length
      if (
        headlineCount < MIN_FORCE_PUBLISH_HEADLINE_COUNT
        || descriptionCount < MIN_FORCE_PUBLISH_DESCRIPTION_COUNT
      ) {
        throw new Error(
          `强制发布失败：Headlines=${headlineCount}，Descriptions=${descriptionCount}。至少需要${MIN_FORCE_PUBLISH_HEADLINE_COUNT}个标题和${MIN_FORCE_PUBLISH_DESCRIPTION_COUNT}个描述。`
        )
      }
      console.warn(
        `[Publish] 强制发布已开启，跳过15/4硬阻断（headlines=${headlineCount}, descriptions=${descriptionCount}）`
      )
    }

    // 1. 获取Google Ads账号（包含currency信息）
    const adsAccount = await db.queryOne(
      `SELECT id, customer_id, currency, parent_mcc_id, is_active
       FROM google_ads_accounts
       WHERE id = ? AND user_id = ? AND is_active = ?`,
      [Number(googleAdsAccountId), Number(userId), 1]
    ) as any

    if (!adsAccount) {
      throw new Error(`Google Ads账号不存在或未激活: ${googleAdsAccountId}`)
    }

    console.log(`💰 使用账号货币: ${adsAccount.currency}`)

    // 2. 检查OAuth凭证或服务账号配置
    const credentials = await getGoogleAdsCredentials(userId)

    // 检查是否有服务账号配置
    const serviceAccount = await db.queryOne(`
      SELECT id FROM google_ads_service_accounts
      WHERE user_id = ? AND is_active = true
      ORDER BY created_at DESC LIMIT 1
    `, [userId]) as { id: string } | undefined

    if ((!credentials || !credentials.refresh_token) && !serviceAccount) {
      throw new Error('OAuth refresh token或服务账号配置缺失，请重新授权或配置服务账号')
    }

    // 获取认证类型和服务账号ID
    const auth = await getUserAuthType(userId)
    const refreshToken = credentials?.refresh_token || ''

    let serviceAccountMccId: string | undefined

    if (auth.authType === 'service_account') {
      try {
        const { getServiceAccountConfig } = await import('@/lib/google-ads-service-account')
        const saConfig = await getServiceAccountConfig(userId, auth.serviceAccountId)
        if (saConfig?.mccCustomerId) {
          serviceAccountMccId = saConfig.mccCustomerId
        }
      } catch (error) {
        console.warn('⚠️ 无法获取服务账号MCC Customer ID:', error)
      }
    }

    const loginCustomerIdCandidates = resolveLoginCustomerCandidates({
      authType: auth.authType,
      accountParentMccId: adsAccount.parent_mcc_id,
      oauthLoginCustomerId: credentials?.login_customer_id,
      serviceAccountMccId,
      targetCustomerId: adsAccount.customer_id,
    })
    let preferredLoginCustomerId = loginCustomerIdCandidates[0]

    const runWithLoginCustomerFallback = async <T>(
      actionName: string,
      callback: (loginCustomerId: string | undefined) => Promise<T>
    ): Promise<T> => {
      const orderedCandidates = [
        preferredLoginCustomerId,
        ...loginCustomerIdCandidates.filter((candidate) => candidate !== preferredLoginCustomerId)
      ]

      let lastError: any = null

      for (let i = 0; i < orderedCandidates.length; i++) {
        const loginCustomerId = orderedCandidates[i]
        try {
          const result = await callback(loginCustomerId)
          preferredLoginCustomerId = loginCustomerId
          if (i > 0) {
            console.log(`✅ ${actionName} 使用备用 login_customer_id=${describeLoginCustomerId(loginCustomerId)} 成功`)
          }
          return result
        } catch (error) {
          lastError = error
          const hasNextCandidate = i < orderedCandidates.length - 1
          if (hasNextCandidate && isGoogleAdsAccountAccessError(error)) {
            const nextLoginCustomerId = orderedCandidates[i + 1]
            console.warn(
              `⚠️ ${actionName} login_customer_id=${describeLoginCustomerId(loginCustomerId)} 失败，切换到 ${describeLoginCustomerId(nextLoginCustomerId)} 重试`
            )
            continue
          }
          throw error
        }
      }

      throw lastError || new Error(`${actionName} 失败`)
    }

    const runWithLoginCustomerFallbackAndHeartbeat = async <T>(
      actionName: string,
      callback: (loginCustomerId: string | undefined) => Promise<T>
    ): Promise<T> => {
      return runWithCampaignHeartbeat(
        actionName,
        () => runWithGoogleAdsQuotaRetry(
          actionName,
          () => runWithLoginCustomerFallback(actionName, callback)
        )
      )
    }

    // 3. 根据货币获取CPC默认值
    const getDefaultCPC = (currency: string): number => {
      const defaults: Record<string, number> = {
        USD: 0.17,
        CNY: 1.2,
        EUR: 0.16,
        GBP: 0.13,
        JPY: 25,
        KRW: 220,
        AUD: 0.26,
        CAD: 0.23,
        CHF: 0.15,
        SEK: 1.8,
        NOK: 1.7,
        DKK: 1.2,
        NZD: 0.29,
        MXN: 3.4,
        BRL: 0.85,
        INR: 14,
        KWD: 0.05,
        BHD: 0.06,
        OMR: 0.06,
        JOD: 0.11,
        TND: 0.5,
        AED: 0.61,
        SAR: 0.62,
        QAR: 0.61,
        HKD: 1.3,
        TWD: 5.4,
        SGD: 0.23,
      }
      return defaults[currency] || 0.17
    }

    // 4. 创建Campaign到Google Ads
    // 注意: 营销目标设置已移除 (2025-12-26)
    // Google Ads会自动推断营销目标，无需手动设置
    totalApiOperations++ // Campaign creation = 1 operation
    // 🔧 修复(2025-12-26): 确保CPC是计费单位的倍数（10000微单位）
    const rawCpcBid = campaignConfig.maxCpcBid || getDefaultCPC(adsAccount.currency)
    const effectiveMaxCpcBid = Math.round(rawCpcBid * 100) / 100  // 四舍五入到0.01
    // 🔧 修复(2026-03-07): 确保micros值是10000的倍数（Google Ads计费单位要求）
    const cpcBidMicros = Math.round(effectiveMaxCpcBid * 100) * 10000  // 转换为micros并确保是10000的倍数

    // 使用关联命名规范（优先）或规范化命名或回退到占位符
    const campaignName = task.data.naming?.associativeCampaignName
      || task.data.naming?.campaignName
      || `Campaign_${creative.id}`
    const adGroupName = task.data.naming?.adGroupName || `AdGroup_${creative.id}`

    const { campaignId: googleCampaignId } = await runWithLoginCustomerFallbackAndHeartbeat(
      '创建Campaign',
      (loginCustomerId) => createGoogleAdsCampaign({
        customerId: adsAccount.customer_id,
        refreshToken: refreshToken,
        campaignName: campaignName, // 🔥 使用规范化命名
        budgetAmount: campaignConfig.budgetAmount,
        budgetType: campaignConfig.budgetType,
        biddingStrategy: campaignConfig.biddingStrategy,
        cpcBidCeilingMicros: cpcBidMicros, // 🔥 使用用户配置或货币默认值（已确保是10000的倍数）
        targetCountry: campaignConfig.targetCountry,
        targetLanguage: campaignConfig.targetLanguage,
        finalUrlSuffix: creative.finalUrlSuffix || undefined,
        status: 'ENABLED',
        accountId: adsAccount.id,
        userId,
        loginCustomerId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId,
      })
    )

    console.log(`✅ Campaign创建成功 (Google ID: ${googleCampaignId})`)
    console.log(`📝 使用命名: Campaign=${campaignName}, AdGroup=${adGroupName}`)

    // 回读远端Google Ads中的真实Campaign名称，作为本地权威名称
    let authoritativeCampaignName = campaignName
    try {
      const campaignDetails = await runWithLoginCustomerFallbackAndHeartbeat(
        '查询Campaign名称',
        (loginCustomerId) => getGoogleAdsCampaign({
          customerId: adsAccount.customer_id,
          refreshToken: refreshToken,
          campaignId: googleCampaignId,
          accountId: adsAccount.id,
          userId,
          loginCustomerId,
          authType: auth.authType,
          serviceAccountId: auth.serviceAccountId,
          skipCache: true,
        })
      )

      const remoteCampaignName = String(campaignDetails?.campaign?.name || '').trim()
      if (remoteCampaignName) {
        authoritativeCampaignName = remoteCampaignName
      }
      if (authoritativeCampaignName !== campaignName) {
        console.log(`🔁 远端名称校准: ${campaignName} -> ${authoritativeCampaignName}`)
      }
    } catch (readNameError: any) {
      console.warn(`⚠️ 回读远端Campaign名称失败，沿用本地生成名称: ${readNameError?.message || readNameError}`)
    }

    // 5. 创建Ad Group（使用相同的货币适配CPC）
    totalApiOperations++ // Ad group creation = 1 operation
    const { adGroupId: googleAdGroupId } = await runWithLoginCustomerFallbackAndHeartbeat(
      '创建Ad Group',
      (loginCustomerId) => createGoogleAdsAdGroup({
        customerId: adsAccount.customer_id,
        refreshToken: refreshToken,
        campaignId: googleCampaignId,
        adGroupName: adGroupName, // 🔥 使用规范化命名
        cpcBidMicros: cpcBidMicros, // 🔥 使用相同的货币适配CPC（已确保是10000的倍数）
        status: 'ENABLED',
        accountId: adsAccount.id,
        userId,
        loginCustomerId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId,
      })
    )

    console.log(`✅ Ad Group创建成功 (Google ID: ${googleAdGroupId})`)

    // 6. 构建关键词映射表
    const keywordMatchTypeMap = new Map<string, PositiveKeywordMatchType>()
    if (creative.keywordsWithVolume) {
      creative.keywordsWithVolume.forEach(kw => {
        const rawKeyword = typeof kw?.keyword === 'string'
          ? kw.keyword
          : (typeof (kw as any)?.text === 'string' ? (kw as any).text : '')
        const normalizedKeyword = normalizeGoogleAdsKeyword(rawKeyword)
        const normalizedMatchType = normalizePositiveKeywordMatchType(
          (kw as any)?.matchType
          ?? (kw as any)?.match_type
          ?? (kw as any)?.suggestedMatchType
          ?? (kw as any)?.suggested_match_type
        )
        if (normalizedKeyword && normalizedMatchType) {
          keywordMatchTypeMap.set(normalizedKeyword, normalizedMatchType)
        }
      })
    }

    const extractExplicitMatchType = (value: unknown): unknown => {
      if (!value || typeof value !== 'object') return undefined
      const row = value as Record<string, unknown>
      return (
        row.matchType
        ?? row.match_type
        ?? row.recommendedMatchType
        ?? row.recommended_match_type
        ?? row.currentMatchType
        ?? row.current_match_type
        ?? row.suggestedMatchType
        ?? row.suggested_match_type
      )
    }

    /**
     * 为Sitelink生成两个不同的描述，提高广告质量
     *
     * @param text Sitelink文本（如"Products", "Support"等）
     * @param baseDescription 基础描述（可选）
     * @returns 包含desc1和desc2的对象
     */
    function generateSitelinkDescriptions(text: string, baseDescription: string = ''): { desc1: string, desc2: string } {
      // 预定义的描述对，根据Sitelink类型智能选择
      const predefinedDescriptions: Record<string, [string, string]> = {
        // 产品相关
        'products': ['Browse our full catalog', 'Latest security solutions'],
        '4k': ['8, 16, & 32 channel kits', 'Professional security solutions'],
        'security systems': ['Complete surveillance kits', 'Easy DIY installation'],

        // 公司信息
        'about': ['Learn about our mission', 'Trusted by millions worldwide'],
        'company': ['Our story & values', 'Industry leader since 2012'],

        // 产品对比
        'compare': ['Compare features & prices', 'Find your perfect match'],
        'poe': ['Wired vs wireless options', 'Expert buying guide'],
        'wifi': ['No cables, easy setup', 'Flexible placement'],
        'cameras': ['Indoor & outdoor models', 'HD & 4K resolution'],

        // 用户反馈
        'review': ['See customer reviews', '4.5+ star average rating'],
        'rating': ['Real user feedback', 'Join 1M+ happy customers'],
        'testimonial': ['What customers say', 'Proven track record'],

        // 支持帮助
        'support': ['Get help and manuals', '24/7 technical assistance'],
        'help': ['Step-by-step guides', 'Video tutorials included'],
        'faq': ['Common questions answered', 'Quick solutions'],

        // 联系方式
        'contact': ['Have questions? Get in touch', 'Expert team ready to help'],
        'call': ['Speak to an expert', 'Free consultation'],
        'email': ['Send us a message', 'Fast response time']
      }

      const safeText = typeof text === 'string' ? text : ''
      const safeBaseDescription = typeof baseDescription === 'string' ? baseDescription : ''
      const textLower = safeText.toLowerCase()

      // 尝试匹配预定义描述（优先匹配更具体的关键词）
      const sortedKeys = Object.keys(predefinedDescriptions).sort((a, b) => b.length - a.length)
      for (const key of sortedKeys) {
        if (textLower.includes(key)) {
          const [desc1, desc2] = predefinedDescriptions[key]
          return { desc1, desc2 }
        }
      }

      // 默认处理：基于baseDescription生成两个相关描述
      if (safeBaseDescription) {
        return {
          desc1: safeBaseDescription,
          desc2: 'Learn more about this'
        }
      }

      // 最基本的默认值
      return {
        desc1: 'Learn more',
        desc2: 'Discover our solutions'
      }
    }

    // 8. 准备关键词数据
    const keywordOperations = (campaignConfig.keywords || [])
      .map((keyword: any) => {
        const keywordStr = typeof keyword === 'string'
          ? keyword
          : (keyword?.text || keyword?.keyword || '')
        const normalizedKeyword = keywordStr.trim()
        if (!normalizedKeyword) return null
        const explicitMatchType = extractExplicitMatchType(keyword)
        const mappedMatchType = keywordMatchTypeMap.get(normalizeGoogleAdsKeyword(normalizedKeyword))
        return {
          keywordText: normalizedKeyword,
          matchType: resolvePositiveKeywordMatchType({
            keyword: normalizedKeyword,
            brandName,
            explicitMatchType,
            mappedMatchType,
          }),
          status: 'ENABLED' as const
        }
      })
      .filter((op): op is NonNullable<typeof op> => op !== null)

    const negativeKeywordMatchTypeMap = normalizeNegativeKeywordMatchTypeMap(
      campaignConfig.negativeKeywordMatchType ||
      campaignConfig.negativeKeywordsMatchType
    )

    // 9. 准备否定关键词数据
    const rawNegativeKeywords = Array.isArray(campaignConfig.negativeKeywords)
      ? campaignConfig.negativeKeywords
      : []
    const uniqueNegativeKeywords: string[] = []
    const seenNegativeKeywords = new Set<string>()
    for (const rawKeyword of rawNegativeKeywords) {
      const keywordText = typeof rawKeyword === 'string'
        ? rawKeyword.trim().replace(/\s+/g, ' ')
        : ''
      if (!keywordText) continue

      const normalizedKey = keywordText.toLowerCase()
      if (seenNegativeKeywords.has(normalizedKey)) continue

      seenNegativeKeywords.add(normalizedKey)
      uniqueNegativeKeywords.push(keywordText)
    }

    if (rawNegativeKeywords.length !== uniqueNegativeKeywords.length) {
      console.log(
        `🧹 否定关键词去重: 原始${rawNegativeKeywords.length}个 -> 有效${uniqueNegativeKeywords.length}个`
      )
    }

    const negativeKeywordOperations = uniqueNegativeKeywords
      .map((keywordText) => {
        const matchType = resolveNegativeKeywordMatchType({
          keyword: keywordText,
          explicitMap: negativeKeywordMatchTypeMap,
        })

        return {
          keywordText,
          matchType,
          negativeKeywordMatchType: matchType,
          status: 'ENABLED' as const,
          isNegative: true
        }
      })

    // 10. 准备Callout Extensions数据
    // 🔧 修复：支持两种格式 - 字符串数组 ["a","b"] 和对象数组 [{"text":"a"}]
    let finalCallouts = creative.callouts || []
    // 转换为字符串数组（兼容对象数组格式）
    finalCallouts = finalCallouts.map((c: any) => {
      if (typeof c === 'string') return c
      if (typeof c === 'object' && c?.text) return c.text
      return null
    }).filter((c: string | null): c is string => c !== null && c.trim().length > 0)

    if (finalCallouts.length === 0) {
      finalCallouts = [
        'Free Shipping',
        '24/7 Support',
        'Quality Guaranteed'
      ]
      console.log(`📝 生成默认Callouts: ${finalCallouts.length}个`)
    }

    // 11. 准备Sitelink Extensions数据
    const normalizedSitelinks = (creative.sitelinks || [])
      .map((link: any) => {
        if (typeof link === 'string') {
          const text = link.trim()
          if (!text) return null
          return { text, url: creative.finalUrl, description: undefined as string | undefined }
        }

        if (typeof link !== 'object' || link === null) return null

        const rawText = typeof link.text === 'string' ? link.text.trim() : ''
        const rawUrl = typeof link.url === 'string' ? link.url.trim() : ''
        const url = rawUrl || creative.finalUrl
        if (!rawText || !url) return null

        const description = typeof link.description === 'string' ? link.description.trim() : undefined
        return { text: rawText, url, description }
      })
      .filter((l): l is NonNullable<typeof l> => l !== null)

    let finalSitelinks = normalizedSitelinks
    if (finalSitelinks.length === 0) {
      finalSitelinks = [
        {
          text: 'Products',
          url: creative.finalUrl,
          description: 'Browse all products'
        },
        {
          text: 'Support',
          url: creative.finalUrl,
          description: 'Get help'
        }
      ]
      console.log(`📝 生成默认Sitelinks: ${finalSitelinks.length}个`)
    }
    const formattedSitelinks = finalSitelinks.map(link => {
      // 使用智能描述生成函数，为每个Sitelink生成两个不同的描述
      const descriptions = generateSitelinkDescriptions(link.text, link.description)
      return {
        text: link.text,
        url: link.url,
        description1: descriptions.desc1,
        description2: descriptions.desc2
      }
    })

    // 12. 串行执行：Keywords + Ad (🔧 修复并发冲突：改为串行避免资源竞争)
    console.log(`\n🔄 开始串行执行Keywords + Ad（避免并发冲突）...`)
    const serialStartTime = Date.now()

    // 12.1 添加正向关键词
    let keywordsCount = 0
    if (keywordOperations.length > 0) {
      totalApiOperations += keywordOperations.length
      await runWithLoginCustomerFallbackAndHeartbeat(
        '创建正向关键词',
        (loginCustomerId) => createGoogleAdsKeywordsBatch({
          customerId: adsAccount.customer_id,
          refreshToken: refreshToken,
          adGroupId: googleAdGroupId,
          keywords: keywordOperations,
          accountId: adsAccount.id,
          userId,
          loginCustomerId,
          authType: auth.authType,
          serviceAccountId: auth.serviceAccountId,
        })
      )
      keywordsCount = keywordOperations.length
      console.log(`  ✅ [串行1/3] 成功添加${keywordsCount}个关键词`)
    }

    // 12.2 添加否定关键词
    let negativeKeywordsCount = 0
    if (negativeKeywordOperations.length > 0) {
      totalApiOperations += negativeKeywordOperations.length
      await runWithLoginCustomerFallbackAndHeartbeat(
        '创建否定关键词',
        (loginCustomerId) => createGoogleAdsKeywordsBatch({
          customerId: adsAccount.customer_id,
          refreshToken: refreshToken,
          adGroupId: googleAdGroupId,
          keywords: negativeKeywordOperations,
          accountId: adsAccount.id,
          userId,
          loginCustomerId,
          authType: auth.authType,
          serviceAccountId: auth.serviceAccountId,
        })
      )
      negativeKeywordsCount = negativeKeywordOperations.length
      console.log(`  ✅ [串行2/3] 成功添加${negativeKeywordsCount}个否定关键词`)
    }

    // 12.3 创建Responsive Search Ad
    // 🔧 新增(2025-12-20): 优化标题，确保包含热门关键词
    console.log(`\n📝 优化广告标题，确保包含热门关键词...`)
    const originalHeadlines = normalizeCreativeTextAssets(creative.headlines).slice(0, REQUIRED_RSA_HEADLINE_COUNT)
    const keywordsForOptimization = (campaignConfig.keywords || [])
      .map((keyword: any) => typeof keyword === 'string' ? keyword : (keyword?.text || keyword?.keyword || ''))
      .map((keyword: any) => String(keyword ?? '').trim())
      .filter((keyword: string) => keyword.length > 0)
    const optimizedHeadlines = ensureKeywordsInHeadlines(
      originalHeadlines,
      keywordsForOptimization,
      brandName,
      3  // 确保 Top 3 关键词被覆盖
    )
    const headlinesForPublish = resolvePublishRsaAssets(
      optimizedHeadlines,
      MIN_FORCE_PUBLISH_HEADLINE_COUNT,
      REQUIRED_RSA_HEADLINE_COUNT,
      'Headlines',
      forcePublish
    )
    const descriptionsForPublish = resolvePublishRsaAssets(
      normalizeCreativeTextAssets(creative.descriptions),
      MIN_FORCE_PUBLISH_DESCRIPTION_COUNT,
      REQUIRED_RSA_DESCRIPTION_COUNT,
      'Descriptions',
      forcePublish
    )

    totalApiOperations++
    const adResult = await runWithLoginCustomerFallbackAndHeartbeat(
      '创建RSA广告',
      (loginCustomerId) => createGoogleAdsResponsiveSearchAd({
        customerId: adsAccount.customer_id,
        refreshToken: refreshToken,
        adGroupId: googleAdGroupId,
        headlines: headlinesForPublish,
        descriptions: descriptionsForPublish,
        finalUrls: [creative.finalUrl],
        path1: creative.path1 || undefined,
        path2: creative.path2 || undefined,
        accountId: adsAccount.id,
        userId,
        loginCustomerId,
        authType: auth.authType,
        serviceAccountId: auth.serviceAccountId
      })
    )
    console.log(`  ✅ [串行3/3] 广告创建成功 (Google ID: ${adResult.adId})`)

    const serialDuration = Date.now() - serialStartTime
    console.log(`🔄 串行执行完成，耗时: ${serialDuration}ms`)
    console.log(`   - 正向关键词: ${keywordsCount}个`)
    console.log(`   - 否定关键词: ${negativeKeywordsCount}个`)
    console.log(`   - 广告ID: ${adResult.adId}`)

    const googleAdId = adResult.adId

    // 13. 串行执行：Extensions（避免并发修改Campaign资源冲突）
    // 🔧 修复(2026-01-05): Extensions是可选扩展，失败不应影响核心发布状态
    console.log(`\n🔄 开始串行执行Extensions（避免并发冲突）...`)
    const extensionsStartTime = Date.now()

    // 跟踪Extensions执行结果（非致命错误）
    let extensionsErrors: string[] = []

    // 13.1 添加Callout Extensions（非致命，失败时记录错误但继续）
    try {
      totalApiOperations += finalCallouts.length + 1
      await runWithLoginCustomerFallbackAndHeartbeat(
        '创建Callout扩展',
        (loginCustomerId) => createGoogleAdsCalloutExtensions({
          customerId: adsAccount.customer_id,
          refreshToken: refreshToken,
          campaignId: googleCampaignId,
          callouts: finalCallouts,
          accountId: adsAccount.id,
          userId,
          loginCustomerId,
          authType: auth.authType,
          serviceAccountId: auth.serviceAccountId
        })
      )
      console.log(`  ✅ [串行1/2] 成功添加${finalCallouts.length}个Callout扩展`)
    } catch (calloutError: any) {
      const errorMsg = calloutError.message || String(calloutError)
      extensionsErrors.push(`Callout扩展: ${errorMsg}`)
      console.warn(`  ⚠️ [串行1/2] Callout扩展失败（非致命）: ${errorMsg}`)
    }

    // 13.2 添加Sitelink Extensions（非致命，失败时记录错误但继续）
    try {
      totalApiOperations += formattedSitelinks.length + 1
      await runWithLoginCustomerFallbackAndHeartbeat(
        '创建Sitelink扩展',
        (loginCustomerId) => createGoogleAdsSitelinkExtensions({
          customerId: adsAccount.customer_id,
          refreshToken: refreshToken,
          campaignId: googleCampaignId,
          sitelinks: formattedSitelinks,
          accountId: adsAccount.id,
          userId,
          loginCustomerId,
          authType: auth.authType,
          serviceAccountId: auth.serviceAccountId
        })
      )
      console.log(`  ✅ [串行2/2] 成功添加${formattedSitelinks.length}个Sitelink扩展`)
    } catch (sitelinkError: any) {
      const errorMsg = sitelinkError.message || String(sitelinkError)
      extensionsErrors.push(`Sitelink扩展: ${errorMsg}`)
      console.warn(`  ⚠️ [串行2/2] Sitelink扩展失败（非致命）: ${errorMsg}`)
    }

    const extensionsDuration = Date.now() - extensionsStartTime
    console.log(`🔄 Extensions串行执行完成，耗时: ${extensionsDuration}ms`)

    // 14. 配置Campaign转化目标为"网页浏览"（非阻塞操作）
    console.log(`\n🎯 配置Campaign转化目标...`)
    try {
      await runWithLoginCustomerFallbackAndHeartbeat(
        '配置Page View目标',
        (loginCustomerId) => setCampaignPageViewGoalWithCredentials({
          customerId: adsAccount.customer_id,
          refreshToken: refreshToken,
          campaignId: googleCampaignId,
          userId,
          loginCustomerId,
          authType: auth.authType,
          serviceAccountId: auth.serviceAccountId,
        })
      )
    } catch (goalError: any) {
      console.warn(`⚠️ 转化目标配置失败（非致命错误）: ${goalError.message}`)
    }

    // 15. 启用Campaign（如果需要）
    let finalCampaignStatus: 'ENABLED' | 'PAUSED' = 'PAUSED'
    if (enableCampaignImmediately) {
      try {
        totalApiOperations++
        await runWithLoginCustomerFallbackAndHeartbeat(
          '启用Campaign',
          (loginCustomerId) => updateGoogleAdsCampaignStatus({
            customerId: adsAccount.customer_id,
            refreshToken: refreshToken,
            campaignId: googleCampaignId,
            status: 'ENABLED',
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: auth.authType,
            serviceAccountId: auth.serviceAccountId,
          })
        )
        finalCampaignStatus = 'ENABLED'
        console.log(`✅ Campaign已启用`)
      } catch (enableError: any) {
        console.warn(`⚠️ Campaign启用失败（非致命错误）: ${enableError.message}`)
      }
    }

    // 16. 更新数据库记录
    // 🔧 修复(2026-01-05): 核心成功但Extensions失败时，仍计为成功，只记录警告信息
    let finalCreationError: string | null = null

    if (extensionsErrors.length > 0) {
      // 核心成功但Extensions失败 → 记录警告信息，不改变成功状态
      finalCreationError = `[警告] ${extensionsErrors.join('; ')}`
    }

    const campaignStateBeforePersist = await db.queryOne<{
      status: string | null
      is_deleted: any
    }>(
      `
        SELECT status, is_deleted
        FROM campaigns
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [campaignId, userId]
    )

    const wasOfflinedDuringPublish =
      (campaignStateBeforePersist?.is_deleted === true || campaignStateBeforePersist?.is_deleted === 1)
      || String(campaignStateBeforePersist?.status || '').toUpperCase() === 'REMOVED'

    if (wasOfflinedDuringPublish) {
      console.warn(`⚠️ Campaign在发布过程中已下线，跳过成功回写（campaignId=${campaignId}, googleCampaignId=${googleCampaignId}）`)
      try {
        await runWithLoginCustomerFallbackAndHeartbeat(
          '发布后兜底暂停Campaign',
          (loginCustomerId) => updateGoogleAdsCampaignStatus({
            customerId: adsAccount.customer_id,
            refreshToken,
            campaignId: googleCampaignId,
            status: 'PAUSED',
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: auth.authType,
            serviceAccountId: auth.serviceAccountId,
          })
        )
      } catch (pauseError: any) {
        console.warn(`⚠️ 发布后兜底暂停失败（不影响本地下线状态）: ${pauseError?.message || pauseError}`)
      }
      apiSuccess = true
      return { success: true, googleCampaignId, googleAdGroupId, googleAdId }
    }

    // 本地名称与远端保持一致（同时同步campaign_config.campaignName）
    try {
      const campaignRow = await db.queryOne<{ campaign_config: unknown }>(
        `
          SELECT campaign_config
          FROM campaigns
          WHERE id = ? AND user_id = ?
          LIMIT 1
        `,
        [campaignId, userId]
      )

      let nextCampaignConfig: string | null = null
      if (campaignRow?.campaign_config !== undefined && campaignRow?.campaign_config !== null) {
        const rawConfig = String(campaignRow.campaign_config)
        try {
          const parsed = JSON.parse(rawConfig)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const merged = {
              ...parsed,
              campaignName: authoritativeCampaignName,
            }
            nextCampaignConfig = JSON.stringify(merged)
          } else {
            nextCampaignConfig = rawConfig
          }
        } catch {
          nextCampaignConfig = rawConfig
        }
      }

      const nowExpr = db.type === 'postgres' ? 'CURRENT_TIMESTAMP' : 'datetime("now")'
      const setConfigSql = nextCampaignConfig !== null ? ', campaign_config = ?' : ''
      const params: Array<string | number> = [
        authoritativeCampaignName,
        ...(nextCampaignConfig !== null ? [nextCampaignConfig] : []),
        campaignId,
        userId,
      ]

      await db.exec(
        `
          UPDATE campaigns
          SET campaign_name = ?${setConfigSql}, updated_at = ${nowExpr}
          WHERE id = ? AND user_id = ?
        `,
        params
      )
    } catch (syncNameError: any) {
      console.warn(`⚠️ 本地Campaign名称回写失败（不影响发布成功）: ${syncNameError?.message || syncNameError}`)
    }

    await applyCampaignTransition({
      userId,
      campaignId,
      action: 'PUBLISH_SUCCEEDED',
      payload: {
        finalStatus: finalCampaignStatus,
        googleCampaignId,
        googleAdGroupId,
        googleAdId,
        creationError: finalCreationError,
      },
    })

    try {
      const backfillResult = await backfillOfferProductLinkForPublishedCampaign({
        userId,
        offerId,
      })
      if (backfillResult.linked) {
        console.log(
          `🔗 发布后已补齐product-offer链路: offer=${offerId}, product=${backfillResult.productId}, reason=${backfillResult.reason}`
        )
      } else {
        console.log(
          `ℹ️ 发布后未补齐product-offer链路: offer=${offerId}, reason=${backfillResult.reason}`
        )
      }
    } catch (backfillError: any) {
      console.warn(
        `⚠️ 发布后补齐product-offer链路失败（不影响发布结果）: ${backfillError?.message || backfillError}`
      )
    }

    // 🔧 发布完成后立即失效 Offer 列表缓存，确保 /offers 页面"关联Ads账号"及时更新
    invalidateOfferCache(userId, offerId)

    // 🔥 新增：发布成功后自动追加换链接任务目标（多账号/多Campaign）
    try {
      if (adsAccount?.customer_id) {
        const added = await addUrlSwapTargetForOfferCampaign({
          offerId,
          userId,
          googleAdsAccountId: adsAccount.id,
          googleCustomerId: adsAccount.customer_id,
          googleCampaignId
        })
        if (added) {
          console.log(`🔗 已追加换链接任务目标: offer=${offerId}, campaign=${googleCampaignId}`)
        }
      }
    } catch (err: any) {
      console.warn('⚠️ 追加换链接任务目标失败（不影响发布）:', err?.message || err)
    }

    apiSuccess = true

    // 🔧 修复(2026-01-05): 区分完全成功和部分成功
    if (extensionsErrors.length === 0) {
      console.log(`\n🎉 Campaign发布成功完成！`)
      console.log(`   📋 命名: Campaign=${authoritativeCampaignName}, AdGroup=${adGroupName}`)
      console.log(`   💰 货币: ${adsAccount.currency}, CPC: ${effectiveMaxCpcBid}`)
      console.log(`   🔗 Google IDs: Campaign=${googleCampaignId}, AdGroup=${googleAdGroupId}, Ad=${googleAdId}`)
      console.log(`   📊 总计 ${totalApiOperations} 个API操作`)
    } else {
      console.log(`\n⚠️ Campaign核心发布成功，但部分扩展失败`)
      console.log(`   📋 命名: Campaign=${authoritativeCampaignName}, AdGroup=${adGroupName}`)
      console.log(`   💰 货币: ${adsAccount.currency}, CPC: ${effectiveMaxCpcBid}`)
      console.log(`   🔗 Google IDs: Campaign=${googleCampaignId}, AdGroup=${googleAdGroupId}, Ad=${googleAdId}`)
      console.log(`   📊 总计 ${totalApiOperations} 个API操作`)
      console.log(`   ⚠️ 扩展失败: ${extensionsErrors.length}项`)
      extensionsErrors.forEach((err, i) => {
        console.log(`      ${i + 1}. ${err}`)
      })
    }

    return {
      success: true,
      googleCampaignId,
      googleAdGroupId,
      googleAdId
    }

  } catch (error: any) {
    apiSuccess = false

    apiErrorMessage = formatGoogleAdsApiError(error)
    console.error(`❌ Campaign发布失败: ${apiErrorMessage}`)
    if (error?.errors && Array.isArray(error.errors) && error.errors.length > 0) {
      console.error(`   错误代码:`, error.errors[0]?.error_code)
      console.error(`   请求ID: ${error.request_id || 'N/A'}`)
    }
    console.error('完整错误对象:', safeJsonStringify(buildErrorLogObject(error), 2))

    // 更新数据库记录为失败状态
    try {
      await applyCampaignTransition({
        userId,
        campaignId,
        action: 'PUBLISH_FAILED',
        payload: {
          errorMessage: apiErrorMessage,
        },
      })
    } catch (dbError: any) {
      console.error(`❌ 更新campaign状态失败: ${dbError.message}`)
    }

    return {
      success: false,
      error: apiErrorMessage
    }

  } finally {
    // 记录API使用
    if (userId) {
      try {
        await trackApiUsage({
          userId: userId,
          operationType: ApiOperationType.MUTATE_BATCH,
          endpoint: 'publishCampaign',
          customerId: task.data.googleAdsAccountId.toString(),
          requestCount: totalApiOperations,
          responseTimeMs: Date.now() - apiStartTime,
          isSuccess: apiSuccess,
          errorMessage: apiErrorMessage
        })
      } catch (trackError: any) {
        console.warn(`⚠️ API追踪失败: ${trackError.message}`)
      }
    }
  }
}
