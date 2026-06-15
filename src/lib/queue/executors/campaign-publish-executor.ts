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
import { runWithLoginCustomerFallbackForAccount } from '@/lib/google-ads/oauth/login-customer'
import {
  createGoogleAdsCampaign,
  createGoogleAdsAdGroup,
  createGoogleAdsKeywordsBatchAllowingDuplicates,
  createGoogleAdsResponsiveSearchAd,
  findGoogleAdsAdGroupByName,
  findGoogleAdsCampaignByName,
  getGoogleAdsCampaign,
  updateGoogleAdsCampaignStatus,
  updateGoogleAdsCampaignBudget,
  createGoogleAdsCalloutExtensions,
  createGoogleAdsSitelinkExtensions,
  ensureKeywordsInHeadlines,
} from '@/lib/google-ads/api/api'
import {
  prepareGoogleAdsApiCallForLinkedAccount,
  preparedAuthContextField,
} from '@/lib/google-ads/accounts/auth/index'
import {
  buildPublishResumePlan,
  collectCampaignNameCandidates,
  persistPublishGoogleAdsIds,
  type PublishResumePlan,
  type ResumablePublishCampaignRow,
} from '@/lib/campaign-publish-resume'
import { setCampaignPageViewGoalWithCredentials } from '@/lib/google-ads/conversion/conversion-goals'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads/api/tracker'
import { type NamingScheme } from '@/lib/naming-convention'
import { invalidateOfferCache } from '@/lib/api-cache'
import { formatGoogleAdsApiError } from '@/lib/google-ads/api/error'
import { addUrlSwapTargetForOfferCampaign } from '@/lib/url-swap'
import { applyCampaignTransition } from '@/lib/campaign-state-machine'
import { backfillOfferProductLinkForPublishedCampaign } from '@/lib/affiliate-products/index'
import {
  normalizeNegativeKeywordMatchTypeMap,
  resolveNegativeKeywordMatchType,
} from '@/lib/campaign-publish/negative-keyword-match-type'
import { normalizeGoogleAdsKeyword } from '@/lib/google-ads/keyword/normalizer'
import {
  normalizePositiveKeywordMatchType,
  resolvePositiveKeywordMatchType,
  type PositiveKeywordMatchType,
} from '@/lib/campaign-publish/positive-keyword-match-type'
import {
  extractGoogleAdsRetryDelaySeconds,
  isGoogleAdsQuotaRateError,
} from '@/lib/google-ads/common/quota-error'
import {
  pauseHistoricalOrphanGoogleCampaignsForOffer,
  pauseOrphanGoogleAdsCampaignAfterPublishFailure,
  type CampaignPublishRollbackContext,
} from '@/lib/campaign-publish-orphan-cleanup'
import {
  buildPublishedCampaignBackupSnapshot,
  trySyncCampaignBackupAfterPublish,
} from '@/lib/campaign-backups'

export type { CampaignPublishRollbackContext } from '@/lib/campaign-publish-orphan-cleanup'

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
  return rawAssets.map((asset) => String(asset || '').trim()).filter((asset) => asset.length > 0)
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

  console.warn(`[Publish] 强制发布资产补齐: ${assetLabel} ${normalized.length} -> ${requiredCount}`)

  return padded
}

/**
 * 广告系列发布任务数据接口
 */
export { pauseOrphanGoogleAdsCampaignAfterPublishFailure } from '@/lib/campaign-publish-orphan-cleanup'

export interface CampaignPublishTaskData {
  // 基础信息
  campaignId: number // 数据库中已创建的campaign记录ID
  offerId: number
  googleAdsAccountId: number
  userId: number

  // 命名规范
  naming?: NamingScheme // 🔥 使用NamingScheme类型，包含associativeCampaignName

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
    negativeKeywordMatchType?: Record<
      string,
      'EXACT' | 'PHRASE' | 'BROAD' | 'BROAD_MATCH_MODIFIER' | 'BMM'
    >
    // 兼容历史字段命名
    negativeKeywordsMatchType?: Record<
      string,
      'EXACT' | 'PHRASE' | 'BROAD' | 'BROAD_MATCH_MODIFIER' | 'BMM'
    >
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
  forcePublish?: boolean // 是否强制发布（允许非15/4创意）
  enableCampaignImmediately?: boolean // 是否立即启用Campaign
  /** 续发：复用上次失败/未完成发布创建的远端资源 */
  resumePublish?: boolean
  /** 从 campaign_backups 恢复发布时传入，成功后回写备份快照 */
  sourceBackupId?: number
}

/**
 * 广告系列发布任务执行器
 */
export async function executeCampaignPublish(task: Task<CampaignPublishTaskData>): Promise<{
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
      if (s.includes('-----BEGIN PRIVATE KEY-----') || s.includes('BEGIN PRIVATE KEY'))
        return '[REDACTED_PRIVATE_KEY]'
      if (s.length > 6000) return `[TRUNCATED_STRING len=${s.length}]`
      return s
    }

    if (typeof value === 'string') return redactString(value)
    if (typeof value !== 'object' || value === null) return value
    if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1))

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
  const creative = task.data.creative
  const campaignConfig = task.data.campaignConfig
  const naming = task.data.naming

  const {
    campaignId,
    offerId,
    googleAdsAccountId,
    userId,
    brandName,
    forcePublish = false,
    enableCampaignImmediately = false,
    resumePublish = false,
  } = task.data

  const apiStartTime = Date.now()
  let apiSuccess = false
  let apiErrorMessage: string | undefined
  let totalApiOperations = 0
  const nowExpr = 'NOW()'
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
  let orphanGoogleCampaignId: string | undefined
  let googleAdGroupId = ''
  let googleAdId = ''
  let publishRollbackContext: CampaignPublishRollbackContext | undefined

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
      console.warn(
        `⚠️ Campaign发布初始心跳更新失败: ${task.id}: ${heartbeatError?.message || heartbeatError}`
      )
    }

    heartbeatTimer = setInterval(() => {
      void touchCampaignHeartbeat(stage).catch((heartbeatError: any) => {
        console.warn(
          `⚠️ Campaign发布心跳更新失败: ${task.id}: ${heartbeatError?.message || heartbeatError}`
        )
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
          isGoogleAdsQuotaRateError(error) && attempt < campaignPublishQuotaRetryMaxRetries

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

        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
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
      campaignSnapshot?.is_deleted === true ||
      campaignSnapshot?.is_deleted === 1 ||
      String(campaignSnapshot?.status || '').toUpperCase() === 'REMOVED'

    if (!campaignSnapshot || campaignAlreadyRemoved) {
      console.log(
        `⏭️ 跳过Campaign发布任务：campaign已下线或不存在（campaignId=${campaignId}, taskId=${task.id}）`
      )
      apiSuccess = true
      return { success: true }
    }

    console.log(
      `[Publish] RSA资产数量校验: headlines=${Array.isArray(creative.headlines) ? creative.headlines.length : 0}, descriptions=${Array.isArray(creative.descriptions) ? creative.descriptions.length : 0}`
    )
    if (!forcePublish) {
      try {
        assertRequiredRsaAssetCounts(creative)
      } catch (error: any) {
        throw new Error(error?.message || 'RSA 资产数量校验失败')
      }
    } else {
      const headlineCount = normalizeCreativeTextAssets(creative.headlines).length
      const descriptionCount = normalizeCreativeTextAssets(creative.descriptions).length
      if (
        headlineCount < MIN_FORCE_PUBLISH_HEADLINE_COUNT ||
        descriptionCount < MIN_FORCE_PUBLISH_DESCRIPTION_COUNT
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
    const adsAccount = (await db.queryOne(
      `SELECT id, customer_id, currency, parent_mcc_id, service_account_id, is_active
       FROM google_ads_accounts
       WHERE id = ? AND user_id = ? AND is_active = ?`,
      [Number(googleAdsAccountId), Number(userId), 1]
    )) as any

    if (!adsAccount) {
      throw new Error(`Google Ads账号不存在或未激活: ${googleAdsAccountId}`)
    }

    console.log(`💰 使用账号货币: ${adsAccount.currency}`)

    const prepared = await prepareGoogleAdsApiCallForLinkedAccount(
      userId,
      adsAccount.service_account_id
    )
    if (!prepared.ok) {
      throw new Error(prepared.message)
    }

    const { apiAuth } = prepared
    const refreshToken = prepared.refreshToken
    const serviceAccountId = apiAuth.serviceAccountId
    const oauthCredentials = prepared.oauthCredentials
    const oauthLoginCustomerId = prepared.oauthLoginCustomerId ?? apiAuth.oauthLoginCustomerId

    let preferredLoginCustomerId: string | undefined

    const runWithLoginCustomerFallback = async <T>(
      actionName: string,
      callback: (loginCustomerId: string | undefined) => Promise<T>
    ): Promise<T> =>
      runWithLoginCustomerFallbackForAccount({
        adsAccount: {
          customer_id: adsAccount.customer_id,
          parent_mcc_id: adsAccount.parent_mcc_id,
          id: adsAccount.id,
        },
        refreshToken,
        authType: apiAuth.authType,
        serviceAccountId,
        serviceAccountMccId: apiAuth.serviceAccountMccId,
        oauthLoginCustomerId,
        preferredLoginCustomerId,
        onLoginCustomerIdResolved: (loginCustomerId) => {
          preferredLoginCustomerId = loginCustomerId
        },
        actionName,
        callback,
      })

    const runWithLoginCustomerFallbackAndHeartbeat = async <T>(
      actionName: string,
      callback: (loginCustomerId: string | undefined) => Promise<T>
    ): Promise<T> => {
      return runWithCampaignHeartbeat(actionName, () =>
        runWithGoogleAdsQuotaRetry(actionName, () =>
          runWithLoginCustomerFallback(actionName, callback)
        )
      )
    }

    publishRollbackContext = {
      customerId: adsAccount.customer_id,
      refreshToken,
      accountId: adsAccount.id,
      userId,
      authType: apiAuth.authType,
      serviceAccountId,
      oauthCredentials,
      oauthLoginCustomerId,
      runWithLoginCustomerFallbackAndHeartbeat,
    }

    const resumableCampaignRow = resumePublish
      ? await db.queryOne<ResumablePublishCampaignRow>(
          `
          SELECT
            id,
            campaign_name,
            creation_status,
            status,
            google_campaign_id,
            campaign_id,
            google_ad_group_id,
            google_ad_id,
            campaign_config,
            google_ads_account_id,
            ad_creative_id,
            budget_amount,
            budget_type,
            max_cpc
          FROM campaigns
          WHERE id = ? AND user_id = ? AND offer_id = ?
          LIMIT 1
        `,
          [campaignId, userId, offerId]
        )
      : null
    const resumePlan: PublishResumePlan = buildPublishResumePlan({
      stored: resumableCampaignRow ?? null,
      enableLocalResume: Boolean(resumePublish && resumableCampaignRow),
      nextCampaignConfig: campaignConfig as Record<string, unknown>,
      nextCreative: {
        headlines: normalizeCreativeTextAssets(creative.headlines),
        descriptions: normalizeCreativeTextAssets(creative.descriptions),
        finalUrl: creative.finalUrl,
        finalUrlSuffix: creative.finalUrlSuffix,
        path1: creative.path1,
        path2: creative.path2,
        callouts: Array.isArray(creative.callouts) ? creative.callouts.map(String) : [],
        sitelinks: creative.sitelinks,
      },
    })

    if (resumePlan.resumeMode) {
      console.log(
        `[Publish] 续发模式: discoverRemote=${resumePlan.discoverRemoteByName}, ` +
          `campaign=${resumePlan.googleCampaignId || '-'}, ` +
          `adGroup=${resumePlan.googleAdGroupId || '-'}, ad=${resumePlan.googleAdId || '-'}`
      )
    }

    const flushPublishGoogleIds = async (ids: {
      googleCampaignId?: string
      googleAdGroupId?: string
      googleAdId?: string
    }) => {
      try {
        await persistPublishGoogleAdsIds({
          userId,
          campaignId,
          googleCampaignId: ids.googleCampaignId,
          googleAdGroupId: ids.googleAdGroupId,
          googleAdId: ids.googleAdId,
        })
      } catch (persistError: any) {
        console.warn(
          `⚠️ 远端 ID 即时回写失败（不影响发布继续）: ${persistError?.message || persistError}`
        )
      }
    }

    await pauseHistoricalOrphanGoogleCampaignsForOffer({
      ctx: publishRollbackContext,
      offerId,
      userId,
      googleAdsAccountId: Number(googleAdsAccountId),
      excludeCampaignId: campaignId,
    })

    // 3. 根据货币获取CPC默认值
    const getDefaultCPC = (currency: string): number => {
      const defaults: Record<string, number> = {
        USD: 0.17,
        CNY: 1.23,
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
    const effectiveMaxCpcBid = Math.round(rawCpcBid * 100) / 100 // 四舍五入到0.01
    // 🔧 修复(2026-03-07): 确保micros值是10000的倍数（Google Ads计费单位要求）
    const cpcBidMicros = Math.round(effectiveMaxCpcBid * 100) * 10000 // 转换为micros并确保是10000的倍数

    const storedCampaignConfig = resumableCampaignRow?.campaign_config
      ? (() => {
          try {
            const parsed = JSON.parse(String(resumableCampaignRow.campaign_config))
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : {}
          } catch {
            return {}
          }
        })()
      : {}

    const storedCampaignName = String(
      storedCampaignConfig.campaignName || storedCampaignConfig.associativeCampaignName || ''
    ).trim()

    const campaignName =
      naming?.associativeCampaignName ||
      naming?.campaignName ||
      storedCampaignName ||
      `Campaign_${creative.id}`

    let googleCampaignId = resumePlan.googleCampaignId || ''

    if (!googleCampaignId && resumePlan.discoverRemoteByName) {
      const campaignNameCandidates = collectCampaignNameCandidates(
        campaignName,
        resumableCampaignRow?.campaign_name,
        storedCampaignConfig.campaignName as string | undefined,
        storedCampaignConfig.associativeCampaignName as string | undefined
      )

      for (const candidateName of campaignNameCandidates) {
        const discovered = await runWithLoginCustomerFallbackAndHeartbeat(
          `查找远端Campaign(${candidateName})`,
          (loginCustomerId) =>
            findGoogleAdsCampaignByName({
              customerId: adsAccount.customer_id,
              refreshToken,
              campaignName: candidateName,
              userId,
              loginCustomerId,
              authType: apiAuth.authType,
              serviceAccountId,
              credentials: oauthCredentials,
              ...preparedAuthContextField(prepared),
            })
        )

        if (discovered?.campaignId) {
          googleCampaignId = discovered.campaignId
          console.log(`🔍 续发：按名称匹配到远端 Campaign ${googleCampaignId}（${candidateName}）`)
          await flushPublishGoogleIds({ googleCampaignId })
          break
        }
      }
    }

    if (googleCampaignId) {
      console.log(`♻️ 续发复用 Campaign (Google ID: ${googleCampaignId})`)
      if (resumePlan.campaignSettingsChanged) {
        totalApiOperations++
        await runWithLoginCustomerFallbackAndHeartbeat('更新Campaign预算', (loginCustomerId) =>
          updateGoogleAdsCampaignBudget({
            customerId: adsAccount.customer_id,
            refreshToken,
            campaignId: googleCampaignId,
            budgetAmount: campaignConfig.budgetAmount,
            budgetType: campaignConfig.budgetType,
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
          })
        )
        console.log(`✅ Campaign预算已更新 (Google ID: ${googleCampaignId})`)
      } else {
        console.log(`⏭️ Campaign 配置未变化，跳过更新`)
      }
    } else {
      const createdCampaign = await runWithLoginCustomerFallbackAndHeartbeat(
        '创建Campaign',
        (loginCustomerId) =>
          createGoogleAdsCampaign({
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
            authType: apiAuth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
          })
      )
      googleCampaignId = createdCampaign.campaignId
      console.log(`✅ Campaign创建成功 (Google ID: ${googleCampaignId})`)
    }

    orphanGoogleCampaignId = googleCampaignId
    await flushPublishGoogleIds({ googleCampaignId })
    console.log(`📝 使用命名: Campaign=${campaignName}（1 Campaign + 1 Ad Group）`)

    // 回读远端Google Ads中的真实Campaign名称，作为本地权威名称
    let authoritativeCampaignName = campaignName
    try {
      const campaignDetails = await runWithLoginCustomerFallbackAndHeartbeat(
        '查询Campaign名称',
        (loginCustomerId) =>
          getGoogleAdsCampaign({
            customerId: adsAccount.customer_id,
            refreshToken: refreshToken,
            campaignId: googleCampaignId,
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
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
      console.warn(
        `⚠️ 回读远端Campaign名称失败，沿用本地生成名称: ${readNameError?.message || readNameError}`
      )
    }

    const extractExplicitMatchType = (value: unknown): unknown => {
      if (!value || typeof value !== 'object') return undefined
      const row = value as Record<string, unknown>
      return (
        row.matchType ??
        row.match_type ??
        row.recommendedMatchType ??
        row.recommended_match_type ??
        row.currentMatchType ??
        row.current_match_type ??
        row.suggestedMatchType ??
        row.suggested_match_type
      )
    }

    function generateSitelinkDescriptions(
      text: string,
      baseDescription: string = ''
    ): { desc1: string; desc2: string } {
      const predefinedDescriptions: Record<string, [string, string]> = {
        products: ['Browse our full catalog', 'Latest security solutions'],
        '4k': ['8, 16, & 32 channel kits', 'Professional security solutions'],
        'security systems': ['Complete surveillance kits', 'Easy DIY installation'],
        about: ['Learn about our mission', 'Trusted by millions worldwide'],
        company: ['Our story & values', 'Industry leader since 2012'],
        compare: ['Compare features & prices', 'Find your perfect match'],
        poe: ['Wired vs wireless options', 'Expert buying guide'],
        wifi: ['No cables, easy setup', 'Flexible placement'],
        cameras: ['Indoor & outdoor models', 'HD & 4K resolution'],
        review: ['See customer reviews', '4.5+ star average rating'],
        rating: ['Real user feedback', 'Join 1M+ happy customers'],
        testimonial: ['What customers say', 'Proven track record'],
        support: ['Get help and manuals', '24/7 technical assistance'],
        help: ['Step-by-step guides', 'Video tutorials included'],
        faq: ['Common questions answered', 'Quick solutions'],
        contact: ['Have questions? Get in touch', 'Expert team ready to help'],
        call: ['Speak to an expert', 'Free consultation'],
        email: ['Send us a message', 'Fast response time'],
      }

      const safeText = typeof text === 'string' ? text : ''
      const safeBaseDescription = typeof baseDescription === 'string' ? baseDescription : ''
      const textLower = safeText.toLowerCase()
      const sortedKeys = Object.keys(predefinedDescriptions).sort((a, b) => b.length - a.length)
      for (const key of sortedKeys) {
        if (textLower.includes(key)) {
          const [desc1, desc2] = predefinedDescriptions[key]
          return { desc1, desc2 }
        }
      }

      if (safeBaseDescription) {
        return { desc1: safeBaseDescription, desc2: 'Learn more about this' }
      }

      return { desc1: 'Learn more', desc2: 'Discover our solutions' }
    }

    const adGroupStartTime = Date.now()
    const adGroupName = naming?.adGroupName || `AdGroup_${creative.id}`

    if (!googleAdGroupId && googleCampaignId && resumePlan.resumeMode) {
      const discoveredAdGroup = await runWithLoginCustomerFallbackAndHeartbeat(
        `查找远端Ad Group(${adGroupName})`,
        (loginCustomerId) =>
          findGoogleAdsAdGroupByName({
            customerId: adsAccount.customer_id,
            refreshToken,
            campaignId: googleCampaignId,
            adGroupName,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
          })
      )

      if (discoveredAdGroup?.adGroupId) {
        googleAdGroupId = discoveredAdGroup.adGroupId
        console.log(`🔍 续发：按名称匹配到远端 Ad Group ${googleAdGroupId}`)
        await flushPublishGoogleIds({ googleCampaignId, googleAdGroupId })
      }
    }

    if (resumePlan.googleAdGroupId && !resumePlan.adGroupSettingsChanged) {
      googleAdGroupId = resumePlan.googleAdGroupId
      console.log(`♻️ 续发复用 Ad Group (Google ID: ${googleAdGroupId})，配置未变化`)
    } else if (googleAdGroupId && resumePlan.resumeMode && !resumePlan.adGroupSettingsChanged) {
      console.log(`♻️ 续发复用 Ad Group (Google ID: ${googleAdGroupId})，配置未变化`)
    } else {
      console.log(`\n🧩 创建 Ad Group: ${adGroupName}`)
      totalApiOperations++
      const { adGroupId: createdAdGroupId } = await runWithLoginCustomerFallbackAndHeartbeat(
        '创建Ad Group',
        (loginCustomerId) =>
          createGoogleAdsAdGroup({
            customerId: adsAccount.customer_id,
            refreshToken: refreshToken,
            campaignId: googleCampaignId,
            adGroupName,
            cpcBidMicros: cpcBidMicros,
            status: 'ENABLED',
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
          })
      )

      googleAdGroupId = createdAdGroupId
      console.log(`✅ Ad Group创建成功 (Google ID: ${googleAdGroupId})`)
      await flushPublishGoogleIds({ googleCampaignId, googleAdGroupId })
    }

    const keywordMatchTypeMap = new Map<string, PositiveKeywordMatchType>()
    if (creative.keywordsWithVolume) {
      creative.keywordsWithVolume.forEach((kw) => {
        const rawKeyword =
          typeof kw?.keyword === 'string'
            ? kw.keyword
            : typeof (kw as any)?.text === 'string'
              ? (kw as any).text
              : ''
        const normalizedKeyword = normalizeGoogleAdsKeyword(rawKeyword)
        const normalizedMatchType = normalizePositiveKeywordMatchType(
          (kw as any)?.matchType ??
            (kw as any)?.match_type ??
            (kw as any)?.suggestedMatchType ??
            (kw as any)?.suggested_match_type
        )
        if (normalizedKeyword && normalizedMatchType) {
          keywordMatchTypeMap.set(normalizedKeyword, normalizedMatchType)
        }
      })
    }

    const keywordOperations = (campaignConfig.keywords || [])
      .map((keyword: any) => {
        const keywordStr =
          typeof keyword === 'string' ? keyword : keyword?.text || keyword?.keyword || ''
        const normalizedKeyword = keywordStr.trim()
        if (!normalizedKeyword) return null
        const explicitMatchType = extractExplicitMatchType(keyword)
        const mappedMatchType = keywordMatchTypeMap.get(
          normalizeGoogleAdsKeyword(normalizedKeyword)
        )
        return {
          keywordText: normalizedKeyword,
          matchType: resolvePositiveKeywordMatchType({
            keyword: normalizedKeyword,
            brandName,
            explicitMatchType,
            mappedMatchType,
          }),
          status: 'ENABLED' as const,
        }
      })
      .filter((op): op is NonNullable<typeof op> => op !== null)

    const negativeKeywordMatchTypeMap = normalizeNegativeKeywordMatchTypeMap(
      campaignConfig.negativeKeywordMatchType || campaignConfig.negativeKeywordsMatchType
    )

    const rawNegativeKeywords = Array.isArray(campaignConfig.negativeKeywords)
      ? campaignConfig.negativeKeywords
      : []
    const uniqueNegativeKeywords: string[] = []
    const seenNegativeKeywords = new Set<string>()
    for (const rawKeyword of rawNegativeKeywords) {
      const keywordText =
        typeof rawKeyword === 'string' ? rawKeyword.trim().replace(/\s+/g, ' ') : ''
      if (!keywordText) continue

      const normalizedKey = keywordText.toLowerCase()
      if (seenNegativeKeywords.has(normalizedKey)) continue

      seenNegativeKeywords.add(normalizedKey)
      uniqueNegativeKeywords.push(keywordText)
    }

    const negativeKeywordOperations = uniqueNegativeKeywords.map((keywordText) => {
      const matchType = resolveNegativeKeywordMatchType({
        keyword: keywordText,
        explicitMap: negativeKeywordMatchTypeMap,
      })
      return {
        keywordText,
        matchType,
        negativeKeywordMatchType: matchType,
        status: 'ENABLED' as const,
        isNegative: true,
      }
    })

    if (keywordOperations.length > 0) {
      totalApiOperations += keywordOperations.length
      await runWithLoginCustomerFallbackAndHeartbeat(
        resumePlan.keywordsChanged ? '创建正向关键词' : '补全正向关键词',
        (loginCustomerId) =>
          createGoogleAdsKeywordsBatchAllowingDuplicates({
            customerId: adsAccount.customer_id,
            refreshToken: refreshToken,
            adGroupId: googleAdGroupId,
            keywords: keywordOperations,
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
          })
      )
    }

    if (negativeKeywordOperations.length > 0) {
      totalApiOperations += negativeKeywordOperations.length
      await runWithLoginCustomerFallbackAndHeartbeat(
        resumePlan.keywordsChanged ? '创建否定关键词' : '补全否定关键词',
        (loginCustomerId) =>
          createGoogleAdsKeywordsBatchAllowingDuplicates({
            customerId: adsAccount.customer_id,
            refreshToken: refreshToken,
            adGroupId: googleAdGroupId,
            keywords: negativeKeywordOperations,
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
          })
      )
    }

    const originalHeadlines = normalizeCreativeTextAssets(creative.headlines).slice(
      0,
      REQUIRED_RSA_HEADLINE_COUNT
    )
    const keywordsForOptimization = (campaignConfig.keywords || [])
      .map((keyword: any) =>
        typeof keyword === 'string' ? keyword : keyword?.text || keyword?.keyword || ''
      )
      .map((keyword: any) => String(keyword ?? '').trim())
      .filter((keyword: string) => keyword.length > 0)
    const optimizedHeadlines = ensureKeywordsInHeadlines(
      originalHeadlines,
      keywordsForOptimization,
      brandName,
      3
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

    if (resumePlan.googleAdId && !resumePlan.rsaChanged) {
      googleAdId = resumePlan.googleAdId
      console.log(`♻️ 续发复用 RSA (Google ID: ${googleAdId})，创意未变化`)
    } else {
      totalApiOperations++
      const adResult = await runWithLoginCustomerFallbackAndHeartbeat(
        resumePlan.googleAdId ? '更新RSA广告（新建）' : '创建RSA广告',
        (loginCustomerId) =>
          createGoogleAdsResponsiveSearchAd({
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
            authType: apiAuth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
          })
      )

      googleAdId = adResult.adId
      await flushPublishGoogleIds({ googleCampaignId, googleAdGroupId, googleAdId })
    }
    console.log(
      `✅ Ad Group + RSA 发布完成 (AdGroup=${googleAdGroupId}, Ad=${googleAdId})，耗时: ${Date.now() - adGroupStartTime}ms`
    )

    const extensionCreative = creative
    let finalCallouts = extensionCreative.callouts || []
    finalCallouts = finalCallouts
      .map((c: any) => {
        if (typeof c === 'string') return c
        if (typeof c === 'object' && c?.text) return c.text
        return null
      })
      .filter((c: string | null): c is string => c !== null && c.trim().length > 0)

    if (finalCallouts.length === 0) {
      finalCallouts = ['Free Shipping', '24/7 Support', 'Quality Guaranteed']
    }

    const normalizedSitelinks = (extensionCreative.sitelinks || [])
      .map((link: any) => {
        if (typeof link === 'string') {
          const text = link.trim()
          if (!text) return null
          return {
            text,
            url: extensionCreative.finalUrl,
            description: undefined as string | undefined,
          }
        }
        if (typeof link !== 'object' || link === null) return null
        const rawText = typeof link.text === 'string' ? link.text.trim() : ''
        const rawUrl = typeof link.url === 'string' ? link.url.trim() : ''
        const url = rawUrl || extensionCreative.finalUrl
        if (!rawText || !url) return null
        const description =
          typeof link.description === 'string' ? link.description.trim() : undefined
        return { text: rawText, url, description }
      })
      .filter((l): l is NonNullable<typeof l> => l !== null)

    let finalSitelinks = normalizedSitelinks
    if (finalSitelinks.length === 0) {
      finalSitelinks = [
        { text: 'Products', url: extensionCreative.finalUrl, description: 'Browse all products' },
        { text: 'Support', url: extensionCreative.finalUrl, description: 'Get help' },
      ]
    }

    const formattedSitelinks = finalSitelinks.map((link) => {
      const descriptions = generateSitelinkDescriptions(link.text, link.description)
      return {
        text: link.text,
        url: link.url,
        description1: descriptions.desc1,
        description2: descriptions.desc2,
      }
    })

    // 13. 串行执行：Extensions（避免并发修改Campaign资源冲突）
    // 🔧 修复(2026-01-05): Extensions是可选扩展，失败不应影响核心发布状态
    console.log(`\n🔄 开始串行执行Extensions（避免并发冲突）...`)
    const extensionsStartTime = Date.now()

    // 跟踪Extensions执行结果（非致命错误）
    let extensionsErrors: string[] = []

    const shouldCreateExtensions = !resumePlan.resumeMode || resumePlan.extensionsChanged

    // 13.1 添加Callout Extensions（非致命，失败时记录错误但继续）
    try {
      if (!shouldCreateExtensions) {
        console.log('⏭️ 续发：扩展未变化，跳过 Callout')
      } else {
        totalApiOperations += finalCallouts.length + 1
        await runWithLoginCustomerFallbackAndHeartbeat('创建Callout扩展', (loginCustomerId) =>
          createGoogleAdsCalloutExtensions({
            customerId: adsAccount.customer_id,
            refreshToken: refreshToken,
            campaignId: googleCampaignId,
            callouts: finalCallouts,
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
          })
        )
        console.log(`  ✅ [串行1/2] 成功添加${finalCallouts.length}个Callout扩展`)
      }
    } catch (calloutError: any) {
      const errorMsg = calloutError.message || String(calloutError)
      extensionsErrors.push(`Callout扩展: ${errorMsg}`)
      console.warn(`  ⚠️ [串行1/2] Callout扩展失败（非致命）: ${errorMsg}`)
    }

    // 13.2 添加Sitelink Extensions（非致命，失败时记录错误但继续）
    try {
      if (!shouldCreateExtensions) {
        console.log('⏭️ 续发：扩展未变化，跳过 Sitelink')
      } else {
        totalApiOperations += formattedSitelinks.length + 1
        await runWithLoginCustomerFallbackAndHeartbeat('创建Sitelink扩展', (loginCustomerId) =>
          createGoogleAdsSitelinkExtensions({
            customerId: adsAccount.customer_id,
            refreshToken: refreshToken,
            campaignId: googleCampaignId,
            sitelinks: formattedSitelinks,
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
          })
        )
        console.log(`  ✅ [串行2/2] 成功添加${formattedSitelinks.length}个Sitelink扩展`)
      }
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
      await runWithLoginCustomerFallbackAndHeartbeat('配置Page View目标', (loginCustomerId) =>
        setCampaignPageViewGoalWithCredentials({
          customerId: adsAccount.customer_id,
          refreshToken: refreshToken,
          campaignId: googleCampaignId,
          userId,
          loginCustomerId,
          authType: apiAuth.authType,
          serviceAccountId,
          credentials: oauthCredentials,
          ...preparedAuthContextField(prepared),
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
        await runWithLoginCustomerFallbackAndHeartbeat('启用Campaign', (loginCustomerId) =>
          updateGoogleAdsCampaignStatus({
            customerId: adsAccount.customer_id,
            refreshToken: refreshToken,
            campaignId: googleCampaignId,
            status: 'ENABLED',
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: apiAuth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
            ...preparedAuthContextField(prepared),
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
      campaignStateBeforePersist?.is_deleted === true ||
      campaignStateBeforePersist?.is_deleted === 1 ||
      String(campaignStateBeforePersist?.status || '').toUpperCase() === 'REMOVED'

    const buildBackupSyncSnapshot = () =>
      buildPublishedCampaignBackupSnapshot({
        campaignName: authoritativeCampaignName,
        campaignConfig: campaignConfig as Record<string, unknown>,
        creative: {
          id: creative.id,
          headlines: creative.headlines,
          descriptions: creative.descriptions,
          finalUrl: creative.finalUrl,
          finalUrlSuffix: creative.finalUrlSuffix,
          path1: creative.path1,
          path2: creative.path2,
          callouts: creative.callouts,
          sitelinks: creative.sitelinks,
        },
        naming: naming ?? undefined,
        googleCampaignId,
        googleAdGroupId,
        googleAdId,
      })

    if (wasOfflinedDuringPublish) {
      console.warn(
        `⚠️ Campaign在发布过程中已下线，跳过成功回写（campaignId=${campaignId}, googleCampaignId=${googleCampaignId}）`
      )
      try {
        await runWithLoginCustomerFallbackAndHeartbeat(
          '发布后兜底暂停Campaign',
          (loginCustomerId) =>
            updateGoogleAdsCampaignStatus({
              customerId: adsAccount.customer_id,
              refreshToken,
              campaignId: googleCampaignId,
              status: 'PAUSED',
              accountId: adsAccount.id,
              userId,
              loginCustomerId,
              authType: apiAuth.authType,
              serviceAccountId,
              credentials: oauthCredentials,
              ...preparedAuthContextField(prepared),
            })
        )
      } catch (pauseError: any) {
        console.warn(
          `⚠️ 发布后兜底暂停失败（不影响本地下线状态）: ${pauseError?.message || pauseError}`
        )
      }
      orphanGoogleCampaignId = undefined
      apiSuccess = true
      await trySyncCampaignBackupAfterPublish({
        userId,
        campaignId,
        offerId,
        sourceBackupId: task.data.sourceBackupId,
        publishedSnapshot: buildBackupSyncSnapshot(),
      })
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

      const nowExpr = 'CURRENT_TIMESTAMP'
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
      console.warn(
        `⚠️ 本地Campaign名称回写失败（不影响发布成功）: ${syncNameError?.message || syncNameError}`
      )
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

    orphanGoogleCampaignId = undefined

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
          googleCampaignId,
        })
        if (added) {
          console.log(`🔗 已追加换链接任务目标: offer=${offerId}, campaign=${googleCampaignId}`)
        }
      }
    } catch (err: any) {
      console.warn('⚠️ 追加换链接任务目标失败（不影响发布）:', err?.message || err)
    }

    apiSuccess = true

    await trySyncCampaignBackupAfterPublish({
      userId,
      campaignId,
      offerId,
      sourceBackupId: task.data.sourceBackupId,
      publishedSnapshot: buildBackupSyncSnapshot(),
    })

    // 🔧 修复(2026-01-05): 区分完全成功和部分成功
    if (extensionsErrors.length === 0) {
      console.log(`\n🎉 Campaign发布成功完成！`)
      console.log(`   📋 命名: Campaign=${authoritativeCampaignName}, AdGroup=${googleAdGroupId}`)
      console.log(`   💰 货币: ${adsAccount.currency}, CPC: ${effectiveMaxCpcBid}`)
      console.log(
        `   🔗 Google IDs: Campaign=${googleCampaignId}, AdGroup=${googleAdGroupId}, Ad=${googleAdId}`
      )
      console.log(`   📊 总计 ${totalApiOperations} 个API操作`)
    } else {
      console.log(`\n⚠️ Campaign核心发布成功，但部分扩展失败`)
      console.log(`   📋 命名: Campaign=${authoritativeCampaignName}, AdGroup=${googleAdGroupId}`)
      console.log(`   💰 货币: ${adsAccount.currency}, CPC: ${effectiveMaxCpcBid}`)
      console.log(
        `   🔗 Google IDs: Campaign=${googleCampaignId}, AdGroup=${googleAdGroupId}, Ad=${googleAdId}`
      )
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
      googleAdId,
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
          ...(orphanGoogleCampaignId ? { googleCampaignId: orphanGoogleCampaignId } : {}),
          ...(googleAdGroupId ? { googleAdGroupId } : {}),
          ...(googleAdId ? { googleAdId } : {}),
        },
      })
    } catch (dbError: any) {
      console.error(`❌ 更新campaign状态失败: ${dbError.message}`)
    }

    if (orphanGoogleCampaignId && publishRollbackContext) {
      await pauseOrphanGoogleAdsCampaignAfterPublishFailure(
        publishRollbackContext,
        orphanGoogleCampaignId
      )
    }

    return {
      success: false,
      error: apiErrorMessage,
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
          errorMessage: apiErrorMessage,
        })
      } catch (trackError: any) {
        console.warn(`⚠️ API追踪失败: ${trackError.message}`)
      }
    }
  }
}
