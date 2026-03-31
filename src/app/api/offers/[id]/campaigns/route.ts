import { NextRequest, NextResponse } from 'next/server'
import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { getDatabase } from '@/lib/db'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { executeGAQLQueryPython } from '@/lib/python-ads-client'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'

// Google Ads CampaignStatus 枚举值映射
// https://developers.google.com/google-ads/api/reference/rpc/latest/CampaignStatusEnum.CampaignStatus
const CampaignStatusMap: Record<number | string, string> = {
  0: 'UNSPECIFIED',
  1: 'UNKNOWN',
  2: 'ENABLED',
  3: 'PAUSED',
  4: 'REMOVED',
  'UNSPECIFIED': 'UNSPECIFIED',
  'UNKNOWN': 'UNKNOWN',
  'ENABLED': 'ENABLED',
  'PAUSED': 'PAUSED',
  'REMOVED': 'REMOVED',
}

function parseCampaignStatus(status: unknown): string {
  if (status === undefined || status === null) return 'UNKNOWN'

  if (typeof status === 'object') {
    const candidate: any = status
    if ('value' in candidate) return parseCampaignStatus(candidate.value)
    if ('name' in candidate) return parseCampaignStatus(candidate.name)
  }

  const mapped = CampaignStatusMap[status as any]
  if (mapped) return mapped

  return String(status).toUpperCase()
}

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
  // 这里做最小映射，避免前端看到 "9"
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

/**
 * GET /api/offers/:id/campaigns
 * 获取Offer关联的所有Google Ads广告系列
 */
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const requestId = request.headers.get('x-request-id') || undefined

    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const db = await getDatabase()
    const numericUserId = parseInt(userId, 10)
    const offerId = parseInt(id, 10)

    const isDeletedCheck = db.type === 'postgres' ? 'c.is_deleted = FALSE' : 'c.is_deleted = 0'

    // 从数据库获取该Offer关联的已发布campaign列表（google_campaign_id非空）
    // 注意：campaigns 有软删除字段 is_deleted，同时 status='REMOVED' 也可视为解除关联/移除标记
    const localCampaigns = await db.query(`
      SELECT
        c.google_campaign_id,
        c.google_ads_account_id,
        c.campaign_name,
        c.max_cpc,
        c.campaign_config,
        c.status,
        gaa.customer_id,
        gaa.account_name,
        gaa.currency,
        gaa.parent_mcc_id,
        gaa.service_account_id,
        gaa.is_active,
        gaa.is_deleted,
        c.created_at
      FROM campaigns c
      LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
      WHERE c.offer_id = ?
        AND c.user_id = ?
        AND ${isDeletedCheck}
        AND c.status != 'REMOVED'
        AND c.google_campaign_id IS NOT NULL
        AND c.google_campaign_id != ''
        AND c.google_ads_account_id IS NOT NULL
      ORDER BY c.created_at DESC
    `, [offerId, numericUserId]) as Array<{
      google_campaign_id: string
      google_ads_account_id: number
      campaign_name: string
      max_cpc: number | null
      campaign_config: string | null
      status: string
      customer_id: string | null
      account_name: string | null
      currency: string | null
      parent_mcc_id: string | null
      service_account_id: string | null
      is_active: any
      is_deleted: any
      created_at: string
    }>

    if (localCampaigns.length === 0) {
      return NextResponse.json({
        success: true,
        campaigns: [],
        message: '该Offer还没有创建任何广告系列，请先发布广告',
      })
    }

    // 按账号分组 campaign ids（一个Offer可能关联多个Ads账号）
    const campaignsByAccountId = new Map<number, {
      customerId: string
      accountName: string | null
      currency: string
      parentMccId: string | null
      serviceAccountId: string | null
      campaignIds: number[]
    }>()

    const localMaxCpcByGoogleCampaignId = new Map<string, number>()
    const localBiddingStrategyByGoogleCampaignId = new Map<string, string>()
    const localStatusByGoogleCampaignId = new Map<string, string>()
    const localCampaignNameByGoogleCampaignId = new Map<string, string>()
    for (const row of localCampaigns) {
      if (!row.customer_id) continue
      const isActive = row.is_active === true || row.is_active === 1
      const isDeleted = row.is_deleted === true || row.is_deleted === 1
      if (!isActive || isDeleted) continue

      const campaignIdNum = Number(row.google_campaign_id)
      if (!Number.isFinite(campaignIdNum)) continue

      if (!localCampaignNameByGoogleCampaignId.has(row.google_campaign_id)) {
        localCampaignNameByGoogleCampaignId.set(row.google_campaign_id, row.campaign_name)
      }
      if (!localStatusByGoogleCampaignId.has(row.google_campaign_id)) {
        localStatusByGoogleCampaignId.set(row.google_campaign_id, row.status)
      }

      // 本地兜底：优先 max_cpc，其次从 campaign_config.maxCpcBid 解析
      const directMaxCpc = Number(row.max_cpc)
      if (Number.isFinite(directMaxCpc) && directMaxCpc > 0) {
        localMaxCpcByGoogleCampaignId.set(row.google_campaign_id, directMaxCpc)
      } else if (row.campaign_config) {
        const cfg = safeParseJson<any>(row.campaign_config)
        const cfgMax = Number(cfg?.maxCpcBid)
        if (Number.isFinite(cfgMax) && cfgMax > 0) {
          localMaxCpcByGoogleCampaignId.set(row.google_campaign_id, cfgMax)
        }
        const cfgStrategy = String(cfg?.biddingStrategy || '').trim()
        if (cfgStrategy) localBiddingStrategyByGoogleCampaignId.set(row.google_campaign_id, cfgStrategy.toUpperCase())
      }

      if (!campaignsByAccountId.has(row.google_ads_account_id)) {
        campaignsByAccountId.set(row.google_ads_account_id, {
          customerId: row.customer_id,
          accountName: row.account_name || null,
          currency: row.currency || 'USD',
          parentMccId: row.parent_mcc_id || null,
          serviceAccountId: row.service_account_id || null,
          campaignIds: []
        })
      }
      campaignsByAccountId.get(row.google_ads_account_id)!.campaignIds.push(campaignIdNum)
    }

    if (campaignsByAccountId.size === 0) {
      return NextResponse.json({
        success: true,
        campaigns: [],
        message: '该Offer关联的Ads账号已解除关联或不可用',
      })
    }

    let credentials: Awaited<ReturnType<typeof getGoogleAdsCredentialsFromDB>> | null = null
    let oauthRefreshToken: string | null = null
    const serviceAccountConfigById = new Map<
      string,
      NonNullable<Awaited<ReturnType<typeof getServiceAccountConfig>>>
    >()

    const groupedAccounts = Array.from(campaignsByAccountId.values())
    const oauthRequired = groupedAccounts.some((account) => {
      const linkedServiceAccountId =
        typeof account.serviceAccountId === 'string' ? account.serviceAccountId.trim() : ''
      return linkedServiceAccountId.length === 0
    })
    const requiredServiceAccountIds = Array.from(new Set(
      groupedAccounts
        .map((account) => (
          typeof account.serviceAccountId === 'string' ? account.serviceAccountId.trim() : ''
        ))
        .filter(Boolean)
    ))

    if (oauthRequired) {
      credentials = await getGoogleAdsCredentialsFromDB(numericUserId)
      oauthRefreshToken = (await getGoogleAdsCredentials(numericUserId))?.refresh_token || null
      if (!oauthRefreshToken) {
        return NextResponse.json({
          error: 'Google Ads OAuth未授权或已过期，请先在设置页面重新授权',
          needsReauth: true,
        }, { status: 400 })
      }
    }

    for (const serviceAccountId of requiredServiceAccountIds) {
      const config = await getServiceAccountConfig(numericUserId, serviceAccountId)
      if (!config) {
        return NextResponse.json({ error: '未找到服务账号配置' }, { status: 400 })
      }
      serviceAccountConfigById.set(serviceAccountId, config)
    }

    const gaqlCampaignById = new Map<number, any>()
    const adGroupCpcMicrosByCampaignId = new Map<number, number>()
    const targetSpendCeilingMicrosByCampaignId = new Map<number, number>()

    const executeOAuthGaqlWithTracking = async (
      customer: any,
      customerId: string,
      queryText: string
    ): Promise<any[]> => {
      const startTime = Date.now()
      try {
        const results = await customer.query(queryText)
        await trackApiUsage({
          userId: numericUserId,
          operationType: ApiOperationType.REPORT,
          endpoint: '/api/google-ads/query',
          customerId,
          requestCount: 1,
          responseTimeMs: Date.now() - startTime,
          isSuccess: true,
        })
        return results
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

    for (const [googleAdsAccountId, account] of campaignsByAccountId.entries()) {
      const uniqueIds = Array.from(new Set(account.campaignIds))
      if (uniqueIds.length === 0) continue

      const adGroupCpcQuery = `
        SELECT
          campaign.id,
          ad_group.id,
          ad_group.cpc_bid_micros
        FROM ad_group
        WHERE campaign.id IN (${uniqueIds.join(', ')})
          AND ad_group.status != 'REMOVED'
          AND ad_group.cpc_bid_micros > 0
        ORDER BY campaign.id, ad_group.id
      `
      const query = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign_budget.amount_micros,
          campaign.bidding_strategy_type,
          campaign.target_cpa.target_cpa_micros,
          campaign.target_roas.target_roas,
          campaign.manual_cpc.enhanced_cpc_enabled,
          campaign.maximize_conversions.target_cpa_micros
        FROM campaign
        WHERE campaign.id IN (${uniqueIds.join(', ')})
        ORDER BY campaign.name
      `

      const targetSpendQuery = (campaignIds: number[]) => `
        SELECT
          campaign.id,
          campaign.target_spend.cpc_bid_ceiling_micros
        FROM campaign
        WHERE campaign.id IN (${campaignIds.join(', ')})
          AND campaign.status != 'REMOVED'
      `

      const linkedServiceAccountId =
        typeof account.serviceAccountId === 'string' ? account.serviceAccountId.trim() : ''
      const useServiceAccount = linkedServiceAccountId.length > 0

      if (useServiceAccount) {
        const linkedServiceAccountConfig = serviceAccountConfigById.get(linkedServiceAccountId)
        if (!linkedServiceAccountConfig) continue
        const serviceAccountId = linkedServiceAccountConfig.id

        // AdGroup CPC best-effort
        try {
          const fetchedAdGroups = await executeGAQLQueryPython({
            userId: numericUserId,
            serviceAccountId,
            customerId: account.customerId,
            query: adGroupCpcQuery,
            requestId
          })
          const adGroupRows = extractSearchResults(fetchedAdGroups)
          for (const row of adGroupRows) {
            const campaignId = Number(row?.campaign?.id)
            if (!Number.isFinite(campaignId)) continue
            if (adGroupCpcMicrosByCampaignId.has(campaignId)) continue
            const micros = Number(row?.ad_group?.cpc_bid_micros)
            if (!Number.isFinite(micros) || micros <= 0) continue
            adGroupCpcMicrosByCampaignId.set(campaignId, micros)
          }
        } catch {
          // ignore
        }

        // Campaign info best-effort（失败不阻断，改为使用DB兜底）
        try {
          const fetched = await executeGAQLQueryPython({
            userId: numericUserId,
            serviceAccountId,
            customerId: account.customerId,
            query,
            requestId
          })
          const rows = extractSearchResults(fetched)
          for (const r of rows) {
            const cid = Number(r?.campaign?.id)
            if (!Number.isFinite(cid) || gaqlCampaignById.has(cid)) continue
            gaqlCampaignById.set(cid, {
              campaign: r.campaign,
              __currency: account.currency,
              __googleAdsAccountId: googleAdsAccountId,
              __adsCustomerId: account.customerId,
              __adsAccountName: account.accountName,
            })
          }
        } catch {
          // ignore
        }

        // target_spend ceiling best-effort（我们发布时使用 TARGET_SPEND，即 Maximize Clicks）
        // 注意：不同API版本/账号状态下该字段可能不可选，失败则使用 AdGroup/DB 兜底
        try {
          const fetchedTargetSpend = await executeGAQLQueryPython({
            userId: numericUserId,
            serviceAccountId,
            customerId: account.customerId,
            query: targetSpendQuery(uniqueIds),
            requestId
          })
          const tsRows = extractSearchResults(fetchedTargetSpend)
          for (const row of tsRows) {
            const cid = Number(row?.campaign?.id)
            if (!Number.isFinite(cid) || targetSpendCeilingMicrosByCampaignId.has(cid)) continue
            const micros = Number(row?.campaign?.target_spend?.cpc_bid_ceiling_micros)
            if (!Number.isFinite(micros) || micros <= 0) continue
            targetSpendCeilingMicrosByCampaignId.set(cid, micros)
          }
        } catch {
          // ignore
        }
      } else {
        const loginCustomerId = credentials?.login_customer_id || account.parentMccId || undefined
        const customer = await getCustomerWithCredentials({
          customerId: account.customerId,
          refreshToken: oauthRefreshToken || undefined,
          loginCustomerId,
          accountId: undefined,
          userId: numericUserId,
        })

        // AdGroup CPC best-effort
        try {
          const fetchedAdGroups = await executeOAuthGaqlWithTracking(
            customer,
            account.customerId,
            adGroupCpcQuery
          )
          const adGroupRows = extractSearchResults(fetchedAdGroups)
          for (const row of adGroupRows) {
            const campaignId = Number(row?.campaign?.id)
            if (!Number.isFinite(campaignId)) continue
            if (adGroupCpcMicrosByCampaignId.has(campaignId)) continue
            const micros = Number(row?.ad_group?.cpc_bid_micros)
            if (!Number.isFinite(micros) || micros <= 0) continue
            adGroupCpcMicrosByCampaignId.set(campaignId, micros)
          }
        } catch {
          // ignore
        }

        // Campaign info best-effort（失败不阻断，改为使用DB兜底）
        try {
          const fetched = await executeOAuthGaqlWithTracking(
            customer,
            account.customerId,
            query
          )
          const rows = extractSearchResults(fetched)
          for (const r of rows) {
            const cid = Number(r?.campaign?.id)
            if (!Number.isFinite(cid) || gaqlCampaignById.has(cid)) continue
            gaqlCampaignById.set(cid, {
              campaign: r.campaign,
              __currency: account.currency,
              __googleAdsAccountId: googleAdsAccountId,
              __adsCustomerId: account.customerId,
              __adsAccountName: account.accountName,
            })
          }
        } catch {
          // ignore
        }

        // target_spend ceiling best-effort（我们发布时使用 TARGET_SPEND，即 Maximize Clicks）
        // 避免依赖 bidding_strategy_type 判断，直接查询 ceiling
        try {
          const fetchedTargetSpend = await executeOAuthGaqlWithTracking(
            customer,
            account.customerId,
            targetSpendQuery(uniqueIds)
          )
          const tsRows = extractSearchResults(fetchedTargetSpend)
          for (const row of tsRows) {
            const cid = Number(row?.campaign?.id)
            if (!Number.isFinite(cid) || targetSpendCeilingMicrosByCampaignId.has(cid)) continue
            const micros = Number(row?.campaign?.target_spend?.cpc_bid_ceiling_micros)
            if (!Number.isFinite(micros) || micros <= 0) continue
            targetSpendCeilingMicrosByCampaignId.set(cid, micros)
          }
        } catch {
          // ignore
        }

      }
    }

    // 以本地关联关系为准输出（GAQL只是补充“真值”与实时状态），避免GAQL失败/异常导致返回错误的campaign列表
    const seenLocal = new Set<string>()
    const formattedCampaigns = localCampaigns
      .filter((row) => {
        const isActive = row.is_active === true || row.is_active === 1
        const isDeleted = row.is_deleted === true || row.is_deleted === 1
        if (!Boolean(row.customer_id) || !isActive || isDeleted) return false
        if (!row.google_campaign_id) return false
        if (seenLocal.has(row.google_campaign_id)) return false
        seenLocal.add(row.google_campaign_id)
        return true
      })
      .map((row) => {
        const campaignIdNum = Number(row.google_campaign_id)
        const ga = Number.isFinite(campaignIdNum) ? gaqlCampaignById.get(campaignIdNum) : undefined
        const gaCampaign = ga?.campaign

      // 默认CPC值（如果没有设置则为0）
      let currentCpc = 0
      const currency = ga?.__currency || row.currency || 'USD'
      const googleCampaignId = row.google_campaign_id
      const rawBiddingStrategyType = toBiddingStrategyType(gaCampaign?.bidding_strategy_type)
      const biddingStrategyType = normalizeBiddingStrategyType(rawBiddingStrategyType)

      // 根据竞价策略类型获取CPC
      // - Manual CPC: 从 ad_group.cpc_bid_micros 推断当前配置（取第一个非0值）
      // - Maximize Clicks: target_spend.cpc_bid_ceiling_micros（我们发布时使用 TARGET_SPEND）
      // - Target CPA: target_cpa_micros（或 maximize_conversions.target_cpa_micros）
      const ceilingMicros = Number.isFinite(campaignIdNum)
        ? (targetSpendCeilingMicrosByCampaignId.get(campaignIdNum) || 0)
        : 0
      const adGroupMicros = Number.isFinite(campaignIdNum)
        ? (adGroupCpcMicrosByCampaignId.get(campaignIdNum) || 0)
        : 0

      const targetCpaMicros = Number(
        gaCampaign?.target_cpa?.target_cpa_micros ||
        gaCampaign?.maximize_conversions?.target_cpa_micros ||
        0
      )

      // 优先用 target_spend ceiling（发布时配置的“最大CPC”），其次用 ad_group.cpc_bid_micros
      if (Number.isFinite(ceilingMicros) && ceilingMicros > 0) {
        currentCpc = ceilingMicros / 1000000
      } else if (Number.isFinite(adGroupMicros) && adGroupMicros > 0) {
        currentCpc = adGroupMicros / 1000000
      } else if (Number.isFinite(targetCpaMicros) && targetCpaMicros > 0) {
        currentCpc = targetCpaMicros / 1000000
      } else {
        // 本地兜底（OAuth/GAQL字段不可用时）：使用发布时配置的 maxCpcBid
        const localMax = localMaxCpcByGoogleCampaignId.get(googleCampaignId) || 0
        if (Number.isFinite(localMax) && localMax > 0) currentCpc = localMax
      }

      const derivedBiddingStrategy =
        (Number.isFinite(ceilingMicros) && ceilingMicros > 0) ? 'MAXIMIZE_CLICKS'
        : (Number.isFinite(adGroupMicros) && adGroupMicros > 0) ? 'MANUAL_CPC'
        : (Number.isFinite(targetCpaMicros) && targetCpaMicros > 0) ? 'TARGET_CPA'
        : localBiddingStrategyByGoogleCampaignId.get(googleCampaignId)
          ? normalizeBiddingStrategyType(localBiddingStrategyByGoogleCampaignId.get(googleCampaignId)!)
          : biddingStrategyType

      return {
        id: googleCampaignId,
        name: gaCampaign?.name || localCampaignNameByGoogleCampaignId.get(googleCampaignId) || googleCampaignId,
        status: gaCampaign?.status !== undefined
          ? parseCampaignStatus(gaCampaign.status)
          : parseCampaignStatus(localStatusByGoogleCampaignId.get(googleCampaignId) || 'UNKNOWN'),
        currentCpc: currentCpc,
        currency: currency,
        biddingStrategy: derivedBiddingStrategy,
        googleAdsAccountId: ga?.__googleAdsAccountId ?? row.google_ads_account_id ?? null,
        adsCustomerId: ga?.__adsCustomerId ?? row.customer_id ?? null,
        adsAccountName: ga?.__adsAccountName ?? row.account_name ?? null,
      }
    })

    return NextResponse.json({
      success: true,
      campaigns: formattedCampaigns,
      count: formattedCampaigns.length,
    })
  } catch (error: any) {
    console.error('获取广告系列失败:', error)

    return NextResponse.json(
      {
        error: error.message || '获取广告系列失败',
      },
      { status: 500 }
    )
  }
}
