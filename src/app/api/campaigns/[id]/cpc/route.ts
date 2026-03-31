import { NextRequest, NextResponse } from 'next/server'

import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { getDatabase } from '@/lib/db'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { getRedisClient } from '@/lib/redis-client'
import { executeGAQLQueryPython } from '@/lib/python-ads-client'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'

function extractSearchResults(result: any): any[] {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.results)) return result.results
  return []
}

function toBiddingStrategyType(value: unknown): string {
  if (value === undefined || value === null) return 'UNKNOWN'
  if (typeof value === 'object') {
    const candidate: any = value
    if ('value' in candidate) return toBiddingStrategyType(candidate.value)
    if ('name' in candidate) return toBiddingStrategyType(candidate.name)
  }
  const raw = String(value).trim()
  // Google Ads API 枚举在不同 SDK/序列化路径下可能会变成数字（例如 "9"）
  // 这里做最小映射，避免前端看到数字枚举
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    if (n === 9) return 'TARGET_SPEND' // 历史 Maximize Clicks
  }
  return raw.toUpperCase()
}

function normalizeBiddingStrategyType(raw: string): string {
  // Maximize Clicks historical alias in some stacks/APIs
  if (raw === 'TARGET_SPEND') return 'MAXIMIZE_CLICKS'
  return raw
}

function normalizeGoogleCampaignId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  return /^\d+$/.test(raw) ? raw : null
}

function safeParseJson<T = any>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value as T
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function toPositiveNumberOrNull(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const requestId = request.headers.get('x-request-id') || undefined
    const userId = request.headers.get('x-user-id')
    if (!userId) return NextResponse.json({ error: '未授权' }, { status: 401 })

    const numericUserId = Number(userId)
    if (!Number.isFinite(numericUserId)) return NextResponse.json({ error: '未授权' }, { status: 401 })

    const executeOAuthGaqlWithTracking = async (customer: any, customerId: string, queryText: string): Promise<any[]> => {
      const startTime = Date.now()
      try {
        const rows = await customer.query(queryText)
        await trackApiUsage({
          userId: numericUserId,
          operationType: ApiOperationType.REPORT,
          endpoint: '/api/google-ads/query',
          customerId,
          requestCount: 1,
          responseTimeMs: Date.now() - startTime,
          isSuccess: true,
        })
        return rows
      } catch (error: any) {
        await trackApiUsage({
          userId: numericUserId,
          operationType: ApiOperationType.REPORT,
          endpoint: '/api/google-ads/query',
          customerId,
          requestCount: 1,
          responseTimeMs: Date.now() - startTime,
          isSuccess: false,
          errorMessage: error?.message || String(error),
        }).catch(() => {})
        throw error
      }
    }

    const campaignIdNum = Number(params.id)
    if (!Number.isFinite(campaignIdNum)) {
      return NextResponse.json({ error: '无效的campaignId' }, { status: 400 })
    }

    const db = await getDatabase()

    const linked = await db.queryOne(`
      SELECT
        c.id as local_campaign_id,
        c.google_ads_account_id,
        c.max_cpc,
        c.campaign_config,
        c.offer_id,
        gaa.customer_id,
        gaa.currency,
        gaa.parent_mcc_id,
        gaa.service_account_id,
        gaa.is_active,
        gaa.is_deleted
      FROM campaigns c
      LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.user_id = ?
        AND c.status != 'REMOVED'
        AND c.google_campaign_id = ?
        AND c.google_ads_account_id IS NOT NULL
      ORDER BY c.created_at DESC
      LIMIT 1
    `, [numericUserId, String(campaignIdNum)]) as {
      local_campaign_id?: number | null
      google_ads_account_id: number
      max_cpc: number | null
      campaign_config: string | null
      offer_id: number | null
      customer_id: string | null
      currency: string | null
      parent_mcc_id: string | null
      service_account_id: string | null
      is_active: any
      is_deleted: any
    } | undefined

    if (!linked?.customer_id) {
      const localCampaign = await db.queryOne(`
        SELECT id, campaign_id, google_campaign_id, status, is_deleted
        FROM campaigns
        WHERE user_id = ?
          AND id = ?
        LIMIT 1
      `, [numericUserId, campaignIdNum]) as {
        id: number
        campaign_id: string | null
        google_campaign_id: string | null
        status: string | null
        is_deleted: any
      } | undefined

      if (localCampaign) {
        const isRemoved = String(localCampaign.status || '').toUpperCase() === 'REMOVED'
          || localCampaign.is_deleted === true
          || localCampaign.is_deleted === 1
        if (isRemoved) {
          return NextResponse.json({ error: '该广告系列已下线/删除，无法查询CPC' }, { status: 400 })
        }

        const expectedGoogleCampaignId =
          normalizeGoogleCampaignId(localCampaign.google_campaign_id)
          || normalizeGoogleCampaignId(localCampaign.campaign_id)
        if (expectedGoogleCampaignId && expectedGoogleCampaignId !== String(campaignIdNum)) {
          return NextResponse.json(
            {
              error: `路由参数语义错误：cpc 的 :id 必须是 googleCampaignId，收到本地 campaign.id=${campaignIdNum}`,
              action: 'USE_GOOGLE_CAMPAIGN_ID',
              localCampaignId: campaignIdNum,
              googleCampaignId: expectedGoogleCampaignId,
              expectedPath: `/api/campaigns/${expectedGoogleCampaignId}/cpc`,
            },
            { status: 422 }
          )
        }

        if (!expectedGoogleCampaignId) {
          return NextResponse.json({ error: '该广告系列尚未发布到Google Ads，无法查询CPC' }, { status: 400 })
        }
      }

      return NextResponse.json({ error: '未找到关联的Ads账号或Campaign未发布' }, { status: 404 })
    }

    const isActive = linked.is_active === true || linked.is_active === 1
    const isDeleted = linked.is_deleted === true || linked.is_deleted === 1
    if (!isActive || isDeleted) {
      return NextResponse.json({ error: '关联的Ads账号不可用（可能已解除关联）' }, { status: 400 })
    }

    const linkedServiceAccountId =
      typeof linked.service_account_id === 'string' ? linked.service_account_id.trim() : ''
    const useServiceAccount = linkedServiceAccountId.length > 0

    let credentials: Awaited<ReturnType<typeof getGoogleAdsCredentialsFromDB>> | null = null
    let serviceAccountId: string | undefined

    if (useServiceAccount) {
      const config = await getServiceAccountConfig(numericUserId, linkedServiceAccountId)
      if (!config) return NextResponse.json({ error: '未找到服务账号配置' }, { status: 400 })
      serviceAccountId = config.id
    } else {
      credentials = await getGoogleAdsCredentialsFromDB(numericUserId)
    }

    const oauthRefreshToken = !useServiceAccount
      ? (await getGoogleAdsCredentials(numericUserId))?.refresh_token || null
      : null

    if (!useServiceAccount && !oauthRefreshToken) {
      return NextResponse.json({ error: 'Google Ads OAuth未授权或已过期', needsReauth: true }, { status: 400 })
    }

    const currency = linked.currency || 'USD'

    // DB 兜底：发布时配置 max_cpc / campaign_config.maxCpcBid（即使 GAQL 失败也要可展示）
    let configuredCpc: number | null = null
    let configuredBiddingStrategy: string | null = null
    const directMaxCpc = Number(linked.max_cpc)
    if (Number.isFinite(directMaxCpc) && directMaxCpc > 0) {
      configuredCpc = directMaxCpc
    } else if (linked.campaign_config) {
      const cfg = safeParseJson<any>(linked.campaign_config)
      const cfgMax = Number(cfg?.maxCpcBid)
      if (Number.isFinite(cfgMax) && cfgMax > 0) configuredCpc = cfgMax
      const cfgStrategy = String(cfg?.biddingStrategy || '').trim()
      if (cfgStrategy) configuredBiddingStrategy = cfgStrategy.toUpperCase()
    }

    const campaignQuery = `
      SELECT
        campaign.id,
        campaign.status,
        campaign.bidding_strategy_type,
        campaign.target_spend.cpc_bid_ceiling_micros,
        campaign.target_cpa.target_cpa_micros,
        campaign.maximize_conversions.target_cpa_micros
      FROM campaign
      WHERE campaign.id = ${campaignIdNum}
        AND campaign.status != 'REMOVED'
    `

    // GAQL 取值（“真值”）：失败不阻断，回退到DB配置
    let campaign: any | null = null
    let biddingStrategyType = 'UNKNOWN'
    let currentCpc: number | null = null
    let targetSpendMicros = 0

    try {
      let campaignRows: any[] = []
      if (useServiceAccount) {
        const fetched = await executeGAQLQueryPython({
          userId: numericUserId,
          serviceAccountId,
          customerId: linked.customer_id,
          query: campaignQuery,
          requestId,
        })
        campaignRows = extractSearchResults(fetched)
      } else {
        const loginCustomerId = credentials?.login_customer_id || linked.parent_mcc_id || undefined
        const customer = await getCustomerWithCredentials({
          customerId: linked.customer_id,
          refreshToken: oauthRefreshToken || undefined,
          loginCustomerId,
          accountId: undefined,
          userId: numericUserId,
        })
        campaignRows = await executeOAuthGaqlWithTracking(customer, linked.customer_id, campaignQuery)
      }

      campaign = campaignRows?.[0]?.campaign || null
      if (campaign) {
        const rawBiddingStrategyType = toBiddingStrategyType(campaign.bidding_strategy_type)
        biddingStrategyType = normalizeBiddingStrategyType(rawBiddingStrategyType)

        targetSpendMicros = Number(campaign.target_spend?.cpc_bid_ceiling_micros || 0)
        if (Number.isFinite(targetSpendMicros) && targetSpendMicros > 0) {
          currentCpc = targetSpendMicros / 1000000
        } else {
          const targetCpaMicros = Number(
            campaign.target_cpa?.target_cpa_micros ||
            campaign.maximize_conversions?.target_cpa_micros ||
            0
          )
          if (Number.isFinite(targetCpaMicros) && targetCpaMicros > 0) {
            currentCpc = targetCpaMicros / 1000000
          }
        }
      }
    } catch {
      // ignore
    }

    // Manual CPC best-effort（仅在还拿不到CPC时尝试）
    if (currentCpc === null || !(currentCpc > 0)) {
      const adGroupQuery = `
        SELECT
          ad_group.cpc_bid_micros
        FROM ad_group
        WHERE campaign.id = ${campaignIdNum}
          AND ad_group.status != 'REMOVED'
          AND ad_group.cpc_bid_micros > 0
        ORDER BY ad_group.id
        LIMIT 1
      `

      let adGroupRows: any[] = []
      try {
        if (useServiceAccount) {
          const fetched = await executeGAQLQueryPython({
            userId: numericUserId,
            serviceAccountId,
            customerId: linked.customer_id,
            query: adGroupQuery,
            requestId,
          })
          adGroupRows = extractSearchResults(fetched)
        } else {
          const loginCustomerId = credentials?.login_customer_id || linked.parent_mcc_id || undefined
          const customer = await getCustomerWithCredentials({
            customerId: linked.customer_id,
            refreshToken: oauthRefreshToken || undefined,
            loginCustomerId,
            accountId: undefined,
            userId: numericUserId,
          })
          adGroupRows = await executeOAuthGaqlWithTracking(customer, linked.customer_id, adGroupQuery)
        }
      } catch {
        // ignore
      }

      const micros = Number(adGroupRows?.[0]?.ad_group?.cpc_bid_micros || 0)
      currentCpc = Number.isFinite(micros) && micros > 0 ? micros / 1000000 : currentCpc
    }

    // DB 兜底：如果 GAQL 拿不到（或返回0），回退到发布时的配置 max_cpc / campaign_config.maxCpcBid
    if (currentCpc === null || !(currentCpc > 0)) currentCpc = configuredCpc

    if (biddingStrategyType === 'UNKNOWN' && configuredBiddingStrategy) {
      biddingStrategyType = normalizeBiddingStrategyType(toBiddingStrategyType(configuredBiddingStrategy))
    }

    const derivedBiddingStrategyType =
      (Number.isFinite(targetSpendMicros) && targetSpendMicros > 0) ? 'MAXIMIZE_CLICKS'
      : (currentCpc !== null && currentCpc > 0 && biddingStrategyType === 'MANUAL_CPC') ? 'MANUAL_CPC'
        : (biddingStrategyType === 'TARGET_CPA') ? 'TARGET_CPA'
          : biddingStrategyType

    const historyCacheKey = linked.offer_id ? `cpc:history:v2:user:${numericUserId}:campaign:${campaignIdNum}` : null
    let history: Array<{ value: number; adjustmentType: string; createdAt: string; successCount: number; failureCount: number }> = []

    if (historyCacheKey) {
      try {
        const redis = getRedisClient()
        const cached = redis ? await redis.get(historyCacheKey) : null
        if (cached) {
          const parsed = safeParseJson<typeof history>(cached)
          if (Array.isArray(parsed)) {
            history = parsed
          }
        }
      } catch {
        // ignore cache errors
      }
    }

    let historyRows: any[] = []
    if (history.length === 0 && linked.offer_id) {
      try {
        historyRows = await db.query(
          `
            SELECT
              adjustment_value,
              adjustment_type,
              created_at,
              campaign_id,
              campaign_ids,
              success_count,
              failure_count
            FROM cpc_adjustment_history
            WHERE user_id = ?
              AND offer_id = ?
            ORDER BY created_at DESC
            LIMIT 8
          `,
          [numericUserId, linked.offer_id]
        )
      } catch {
        historyRows = await db.query(
          `
            SELECT
              adjustment_value,
              adjustment_type,
              created_at,
              campaign_ids,
              success_count,
              failure_count
            FROM cpc_adjustment_history
            WHERE user_id = ?
              AND offer_id = ?
            ORDER BY created_at DESC
            LIMIT 8
          `,
          [numericUserId, linked.offer_id]
        )
      }
    }

    if (history.length === 0 && historyRows.length > 0) {
      const googleCampaignToken = String(campaignIdNum)
      const localCampaignToken = linked.local_campaign_id !== null && linked.local_campaign_id !== undefined
        ? String(linked.local_campaign_id)
        : null
      const matchedHistoryRows = historyRows
        .filter((row: any) => {
          if (row.campaign_id !== null && row.campaign_id !== undefined) {
            const rowToken = String(row.campaign_id)
            if (rowToken === googleCampaignToken) return true
            if (localCampaignToken && rowToken === localCampaignToken) return true
            return false
          }
          const ids = safeParseJson<string[]>(row.campaign_ids)
          if (Array.isArray(ids)) {
            const normalized = ids.map(String)
            if (normalized.includes(googleCampaignToken)) return true
            if (localCampaignToken && normalized.includes(localCampaignToken)) return true
            return false
          }
          const raw = typeof row.campaign_ids === 'string' ? row.campaign_ids : ''
          const tokens = raw.split(',').map((value: string) => value.trim()).filter(Boolean)
          if (tokens.includes(googleCampaignToken)) return true
          if (localCampaignToken && tokens.includes(localCampaignToken)) return true
          return false
        })
      // 兼容历史写法：adjustment_value 曾记录“调整后值”，这里统一转换为“调整前值”展示。
      history = matchedHistoryRows
        .map((row: any) => ({
          adjustmentValue: toPositiveNumberOrNull(row.adjustment_value),
          adjustmentType: row.adjustment_type,
          createdAt: row.created_at,
          successCount: Number(row.success_count) || 0,
          failureCount: Number(row.failure_count) || 0,
        }))
        .map((row, index, rows) => {
          const previousFromNextAdjustment = rows[index + 1]?.adjustmentValue ?? null
          const previousFromInitialConfig = configuredCpc !== null && configuredCpc > 0 ? configuredCpc : null
          const previousValue = previousFromNextAdjustment ?? previousFromInitialConfig
          return {
            value: previousValue ?? row.adjustmentValue ?? 0,
            adjustmentType: row.adjustmentType,
            createdAt: row.createdAt,
            successCount: row.successCount,
            failureCount: row.failureCount,
          }
        })

      if (historyCacheKey && history.length > 0) {
        try {
          const redis = getRedisClient()
          if (redis) {
            await redis.setex(historyCacheKey, CPC_HISTORY_CACHE_TTL, JSON.stringify(history))
          }
        } catch {
          // ignore cache errors
        }
      }
    }

    return NextResponse.json({
      success: true,
      campaignId: String(campaignIdNum),
      biddingStrategyType: derivedBiddingStrategyType,
      currency,
      currentCpc,
      history,
    })
  } catch (error: any) {
    console.error('获取Campaign CPC配置失败:', error)
    return NextResponse.json({ error: error.message || '获取Campaign CPC配置失败' }, { status: 500 })
  }
}
const CPC_HISTORY_CACHE_TTL = 900
