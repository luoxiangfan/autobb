import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB } from '@/lib/google-ads-api'
import { getDatabase } from '@/lib/db'
import { getServiceAccountConfig } from '@/lib/google-ads-service-account'
import { getGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import { executeGAQLQueryPython, updateCampaignPython, updateAdGroupPython } from '@/lib/python-ads-client'
import { normalizeGoogleAdsApiUpdateOperations } from '@/lib/google-ads-mutate-helpers'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads-api-tracker'
import { invalidateDashboardCache, invalidateOfferCache } from '@/lib/api-cache'

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
  return String(value).toUpperCase()
}

function normalizeGoogleCampaignId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim()
  if (!raw) return null
  return /^\d+$/.test(raw) ? raw : null
}

function toPositiveNumberOrNull(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * 统一的 Mutate 操作（支持 OAuth 和服务账号两种认证模式）
 * 🔧 修复(2025-12-26): 服务账号模式使用 Python 服务更新
 *
 * @param customer - Google Ads 客户端
 * @param isServiceAccount - 是否为服务账号模式
 * @param mutateType - mutate 类型 (ad_group, campaign 等)
 * @param operations - 操作数组
 * @param userId - 用户ID（服务账号模式需要）
 * @param serviceAccountId - 服务账号ID（服务账号模式需要）
 * @param customerId - 客户ID（服务账号模式需要）
 */
async function mutateResources(
  customer: any,
  isServiceAccount: boolean,
  mutateType: string,
  operations: any[],
  userId: number,
  serviceAccountId: string | undefined,
  customerId: string,
  requestId?: string
): Promise<void> {
  if (isServiceAccount) {
    // 服务账号模式：使用 Python 服务更新
    const { updateCampaignPython, updateAdGroupPython } = await import('@/lib/python-ads-client')

    for (const op of operations) {
      const resourceName = op.update.resource_name

      if (mutateType === 'campaign') {
        const targetCpaMicros = op.update?.target_cpa?.target_cpa_micros
        const cpcBidMicros = op.update?.cpc_bid_micros

        await updateCampaignPython({
          userId,
          serviceAccountId,
          customerId,
          campaignResourceName: resourceName,
          cpcBidMicros,
          targetCpaMicros,
          requestId,
        })
      } else if (mutateType === 'ad_group') {
        const cpcBidMicros = op.update?.cpc_bid_micros
        await updateAdGroupPython({
          userId,
          serviceAccountId,
          customerId,
          adGroupResourceName: resourceName,
          cpcBidMicros,
          requestId,
        })
      } else {
        throw new Error(`服务账号模式不支持的 mutate 类型: ${mutateType}`)
      }
    }
  } else {
    // OAuth 模式：使用 google-ads-api 的 update 方法
    const updateOperations = normalizeGoogleAdsApiUpdateOperations(operations)
    const startTime = Date.now()
    const endpoint = mutateType === 'ad_group'
      ? '/api/google-ads/adgroup/update'
      : '/api/google-ads/campaign/update'
    const operationType = updateOperations.length > 1 ? ApiOperationType.MUTATE_BATCH : ApiOperationType.MUTATE

    try {
      switch (mutateType) {
        case 'ad_group':
          await customer.adGroups.update(updateOperations)
          break
        case 'campaign':
          await customer.campaigns.update(updateOperations)
          break
        default:
          throw new Error(`不支持的 mutate 类型: ${mutateType}`)
      }

      await trackApiUsage({
        userId,
        operationType,
        endpoint,
        customerId,
        requestCount: Math.max(1, updateOperations.length),
        responseTimeMs: Date.now() - startTime,
        isSuccess: true,
      })
    } catch (error: any) {
      await trackApiUsage({
        userId,
        operationType,
        endpoint,
        customerId,
        requestCount: Math.max(1, updateOperations.length),
        responseTimeMs: Date.now() - startTime,
        isSuccess: false,
        errorMessage: error?.message || String(error),
      }).catch(() => {})
      throw error
    }
  }
}

/**
 * PUT /api/campaigns/:id/update-cpc
 * 更新广告系列的CPC出价
 *
 * - :id 必须是 Google Ads campaign id（google_campaign_id）
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: campaignId } = params
    const requestId = request.headers.get('x-request-id') || undefined

    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    const numericUserId = Number(authResult.user.userId)
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    const campaignIdNum = Number(campaignId)
    if (!Number.isFinite(campaignIdNum)) {
      return NextResponse.json({ error: '无效的campaignId' }, { status: 400 })
    }

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

    const body = await request.json()
    const { newCpc } = body

    if (!newCpc || newCpc <= 0) {
      return NextResponse.json(
        { error: '请提供有效的CPC值' },
        { status: 400 }
      )
    }

    // 通过本地campaign映射找到对应的Ads账号（避免用“第一个账号”导致权限/账号不匹配）
    const db = await getDatabase()
    const linked = await db.queryOne(`
      SELECT id as local_campaign_id, google_ads_account_id, offer_id
      FROM campaigns
      WHERE user_id = ?
        AND status != 'REMOVED'
        AND google_campaign_id = ?
        AND google_ads_account_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `, [numericUserId, String(campaignId)]) as { local_campaign_id?: number | string | null; google_ads_account_id: number; offer_id: number | null } | undefined

    if (!linked?.google_ads_account_id) {
      // 严格语义校验：该路由的 :id 必须是 google_campaign_id，不接受本地 campaigns.id
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
          return NextResponse.json(
            { error: '该广告系列已下线/删除，无法调整CPC' },
            { status: 400 }
          )
        }

        const expectedGoogleCampaignId =
          normalizeGoogleCampaignId(localCampaign.google_campaign_id)
          || normalizeGoogleCampaignId(localCampaign.campaign_id)

        if (expectedGoogleCampaignId && expectedGoogleCampaignId !== String(campaignIdNum)) {
          return NextResponse.json(
            {
              error: `路由参数语义错误：update-cpc 的 :id 必须是 googleCampaignId，收到本地 campaign.id=${campaignIdNum}`,
              action: 'USE_GOOGLE_CAMPAIGN_ID',
              localCampaignId: campaignIdNum,
              googleCampaignId: expectedGoogleCampaignId,
              expectedPath: `/api/campaigns/${expectedGoogleCampaignId}/update-cpc`,
            },
            { status: 422 }
          )
        }

        if (!expectedGoogleCampaignId) {
          return NextResponse.json(
            { error: '该广告系列尚未发布到Google Ads，无法调整CPC' },
            { status: 400 }
          )
        }
      }

      return NextResponse.json(
        { error: '未找到该广告系列对应的Ads账号，请确认该广告系列已由系统发布' },
        { status: 404 }
      )
    }

    const adsAccountRow = await db.queryOne(`
      SELECT id, customer_id, parent_mcc_id, service_account_id, is_active, is_deleted
      FROM google_ads_accounts
      WHERE id = ? AND user_id = ?
    `, [linked.google_ads_account_id, numericUserId]) as any

    const offerId = linked.offer_id
    const localCampaignIdRaw = linked.local_campaign_id
    const localCampaignIdNum = Number(localCampaignIdRaw)
    const localCampaignId = Number.isFinite(localCampaignIdNum) ? localCampaignIdNum : null
    const invalidateRelatedCaches = () => {
      const numericOfferId = Number(offerId)
      if (Number.isFinite(numericOfferId) && numericOfferId > 0) {
        invalidateOfferCache(numericUserId, numericOfferId)
      } else {
        invalidateDashboardCache(numericUserId)
      }
    }
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    const syncLocalConfiguredMaxCpc = async (nextMaxCpc: number) => {
      const normalized = toPositiveNumberOrNull(nextMaxCpc)
      if (normalized === null) return

      await db.exec(
        `
          UPDATE campaigns
          SET
            max_cpc = ?,
            updated_at = ${nowFunc}
          WHERE user_id = ?
            AND google_campaign_id = ?
            AND status != 'REMOVED'
        `,
        [normalized, numericUserId, String(campaignIdNum)]
      )
    }
    const recordHistory = async (
      adjustmentType: string,
      successCount: number,
      failureCount: number,
      errorMessage?: string | null
    ) => {
      if (!offerId) return
      try {
        try {
          await db.exec(
            `
              INSERT INTO cpc_adjustment_history (
                user_id,
                offer_id,
                campaign_id,
                adjustment_type,
                adjustment_value,
                affected_campaign_count,
                campaign_ids,
                success_count,
                failure_count,
                error_message,
                created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc})
            `,
            [
              numericUserId,
              offerId,
              localCampaignId,
              adjustmentType,
              newCpc,
              1,
              JSON.stringify([String(campaignIdNum)]),
              successCount,
              failureCount,
              errorMessage || null,
            ]
          )
        } catch (insertError: any) {
          const message = String(insertError?.message || insertError || '')
          if (message.includes('campaign_id')) {
            await db.exec(
              `
                INSERT INTO cpc_adjustment_history (
                  user_id,
                  offer_id,
                  adjustment_type,
                  adjustment_value,
                  affected_campaign_count,
                  campaign_ids,
                  success_count,
                  failure_count,
                  error_message,
                  created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc})
              `,
              [
                numericUserId,
                offerId,
                adjustmentType,
                newCpc,
                1,
                JSON.stringify([String(campaignIdNum)]),
                successCount,
                failureCount,
                errorMessage || null,
              ]
            )
          } else {
            throw insertError
          }
        }
        try {
          const { getRedisClient } = await import('@/lib/redis-client')
          const redis = getRedisClient()
          if (redis) {
            const cacheKey = `cpc:history:v2:user:${numericUserId}:campaign:${campaignIdNum}`
            await redis.del(cacheKey)
          }
        } catch {
          // ignore cache errors
        }
      } catch (err: any) {
        console.warn('[update-cpc] failed to record history:', err?.message || err)
      }
    }

    const isAccountActive = adsAccountRow?.is_active === true || adsAccountRow?.is_active === 1
    const isAccountDeleted = adsAccountRow?.is_deleted === true || adsAccountRow?.is_deleted === 1

    if (!adsAccountRow || !isAccountActive || isAccountDeleted) {
      return NextResponse.json(
        { error: '关联的Ads账号不可用（可能已解除关联），无法调整CPC' },
        { status: 400 }
      )
    }

    const linkedServiceAccountId =
      typeof adsAccountRow?.service_account_id === 'string'
        ? adsAccountRow.service_account_id.trim()
        : ''
    const useServiceAccount = linkedServiceAccountId.length > 0

    let credentials: Awaited<ReturnType<typeof getGoogleAdsCredentialsFromDB>> | null = null
    let customer: any
    let serviceAccountId: string | undefined

    if (useServiceAccount) {
      // 服务账号模式 - 检查配置是否存在
      const config = await getServiceAccountConfig(numericUserId, linkedServiceAccountId)

      if (!config) {
        return NextResponse.json(
          { error: '未找到服务账号配置' },
          { status: 400 }
        )
      }
      serviceAccountId = config.id
      const serviceAccountMccId = config.mccCustomerId ? String(config.mccCustomerId) : undefined

      // 使用统一客户端（服务账号模式）
      customer = await getCustomerWithCredentials({
        customerId: adsAccountRow.customer_id,
        accountId: adsAccountRow.id,
        userId: numericUserId,
        loginCustomerId: serviceAccountMccId || adsAccountRow.parent_mcc_id || undefined,
        authType: 'service_account',
        serviceAccountId,
      })
    } else {
      // OAuth 模式才读取 OAuth 基础凭证，避免服务账号路径触发 OAuth 必填校验
      credentials = await getGoogleAdsCredentialsFromDB(numericUserId)

      // OAuth 模式
      const oauthCredentials = await getGoogleAdsCredentials(numericUserId)
      if (!oauthCredentials?.refresh_token) {
        return NextResponse.json(
          {
            error: 'Google Ads未授权或已过期，请重新授权',
            needsReauth: true,
          },
          { status: 400 }
        )
      }

      const loginCustomerId = credentials.login_customer_id || adsAccountRow.parent_mcc_id || undefined

      // 使用统一客户端（OAuth模式）
      customer = await getCustomerWithCredentials({
        customerId: adsAccountRow.customer_id,
        refreshToken: oauthCredentials.refresh_token,
        loginCustomerId,
        credentials: {
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          developer_token: credentials.developer_token,
        },
        accountId: adsAccountRow.id,
        userId: numericUserId,
      })
    }

    // 查询广告系列信息，获取竞价策略类型
    const campaignQuery = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.bidding_strategy_type,
        campaign.status,
        campaign.target_spend.cpc_bid_ceiling_micros,
        campaign.manual_cpc.enhanced_cpc_enabled,
        campaign.target_cpa.target_cpa_micros,
        campaign.maximize_conversions.target_cpa_micros
      FROM campaign
      WHERE campaign.id = ${campaignIdNum}
    `

    // 根据认证模式选择正确的查询方法
    const campaignRawResults = useServiceAccount
      ? await executeGAQLQueryPython({ userId: numericUserId, serviceAccountId, customerId: adsAccountRow.customer_id, query: campaignQuery, requestId })
      : await executeOAuthGaqlWithTracking(customer, adsAccountRow.customer_id, campaignQuery)
    const campaignResults = extractSearchResults(campaignRawResults)

    if (campaignResults.length === 0) {
      return NextResponse.json(
        { error: '广告系列不存在' },
        { status: 404 }
      )
    }

    const campaign = campaignResults[0].campaign
    if (!campaign) {
      return NextResponse.json(
        { error: '未找到广告系列数据' },
        { status: 404 }
      )
    }

    const hasTargetSpend =
      campaign?.target_spend?.cpc_bid_ceiling_micros !== undefined

    const hasManualCpc =
      campaign?.manual_cpc?.enhanced_cpc_enabled !== undefined

    const hasTargetCpa =
      campaign?.target_cpa?.target_cpa_micros !== undefined ||
      campaign?.maximize_conversions?.target_cpa_micros !== undefined

    // 根据竞价策略类型更新CPC（服务账号模式下枚举可能会被序列化为数字，优先用字段存在性判断）
    const biddingStrategyType =
      hasTargetSpend ? 'TARGET_SPEND'
      : hasManualCpc ? 'MANUAL_CPC'
      : hasTargetCpa ? 'TARGET_CPA'
      : toBiddingStrategyType(campaign.bidding_strategy_type)

    if (biddingStrategyType === 'MANUAL_CPC') {
      // Manual CPC: 更新该广告系列下所有Ad Group的CPC
      const adGroupQuery = `
        SELECT
          ad_group.id,
          ad_group.name,
          ad_group.status
        FROM ad_group
        WHERE campaign.id = ${campaignIdNum}
          AND ad_group.status != 'REMOVED'
      `

      // 根据认证模式选择正确的查询方法
      const adGroupRawResults = useServiceAccount
        ? await executeGAQLQueryPython({ userId: numericUserId, serviceAccountId, customerId: adsAccountRow.customer_id, query: adGroupQuery, requestId })
        : await executeOAuthGaqlWithTracking(customer, adsAccountRow.customer_id, adGroupQuery)
      const adGroups = extractSearchResults(adGroupRawResults)

      if (adGroups.length === 0) {
        return NextResponse.json(
          { error: '该广告系列下没有广告组' },
          { status: 400 }
        )
      }

      // 更新每个Ad Group的CPC
      // 🔧 修复(2026-03-07): 确保micros值是10000的倍数（Google Ads计费单位要求）
      const cpcMicros = Math.round(newCpc * 100) * 10000 // 转换为微单位并确保是10000的倍数

      const adGroupOperations = adGroups.map((adGroup: any) => ({
        update: {
          resource_name: `customers/${adsAccountRow.customer_id}/adGroups/${adGroup.ad_group.id}`,
          cpc_bid_micros: cpcMicros,
        },
        update_mask: 'cpc_bid_micros',
      }))

      // 批量更新Ad Groups
      await mutateResources(
        customer,
        useServiceAccount,
        'ad_group',
        adGroupOperations,
        numericUserId,
        serviceAccountId,
        adsAccountRow.customer_id,
        requestId
      )

      await syncLocalConfiguredMaxCpc(newCpc)
      await recordHistory('manual_cpc', adGroups.length, 0, null)
      invalidateRelatedCaches()

      return NextResponse.json({
        success: true,
        message: `成功更新 ${adGroups.length} 个广告组的CPC为 ${newCpc}`,
        updatedAdGroups: adGroups.length,
        newCpc: newCpc,
      })
    } else if (biddingStrategyType === 'TARGET_SPEND') {
      // TARGET_SPEND: 历史上的 Maximize Clicks（设置 target_spend.cpc_bid_ceiling_micros）
      // 🔧 修复(2026-03-07): 确保micros值是10000的倍数（Google Ads计费单位要求）
      const cpcMicros = Math.round(newCpc * 100) * 10000

      if (useServiceAccount) {
        await updateCampaignPython({
          userId: numericUserId,
          serviceAccountId,
          customerId: adsAccountRow.customer_id,
          campaignResourceName: `customers/${adsAccountRow.customer_id}/campaigns/${campaignId}`,
          cpcBidMicros: cpcMicros,
          requestId,
        })
      } else {
        const campaignOperation = {
          update: {
            resource_name: `customers/${adsAccountRow.customer_id}/campaigns/${campaignId}`,
            target_spend: {
              cpc_bid_ceiling_micros: cpcMicros,
            },
          },
          update_mask: 'target_spend.cpc_bid_ceiling_micros',
        }

        await mutateResources(
          customer,
          useServiceAccount,
          'campaign',
          [campaignOperation],
          numericUserId,
          serviceAccountId,
          adsAccountRow.customer_id,
          requestId
        )
      }

      await syncLocalConfiguredMaxCpc(newCpc)
      await recordHistory('max_cpc', 1, 0, null)
      invalidateRelatedCaches()

      return NextResponse.json({
        success: true,
        message: `成功更新广告系列的最大CPC限制为 ${newCpc}`,
        newCpc: newCpc,
      })
    } else if (biddingStrategyType === 'MAXIMIZE_CLICKS') {
      // MAXIMIZE_CLICKS: 这里统一按 TARGET_SPEND 处理（发布时即使用 TARGET_SPEND + target_spend ceiling）
      // 🔧 修复(2026-03-07): 确保micros值是10000的倍数（Google Ads计费单位要求）
      const cpcMicros = Math.round(newCpc * 100) * 10000

      if (useServiceAccount) {
        await updateCampaignPython({
          userId: numericUserId,
          serviceAccountId,
          customerId: adsAccountRow.customer_id,
          campaignResourceName: `customers/${adsAccountRow.customer_id}/campaigns/${campaignId}`,
          cpcBidMicros: cpcMicros,
          requestId,
        })
      } else {
        const campaignOperation = {
          update: {
            resource_name: `customers/${adsAccountRow.customer_id}/campaigns/${campaignId}`,
            target_spend: {
              cpc_bid_ceiling_micros: cpcMicros,
            },
          },
          update_mask: 'target_spend.cpc_bid_ceiling_micros',
        }

        await mutateResources(
          customer,
          useServiceAccount,
          'campaign',
          [campaignOperation],
          numericUserId,
          serviceAccountId,
          adsAccountRow.customer_id,
          requestId
        )
      }

      await syncLocalConfiguredMaxCpc(newCpc)
      await recordHistory('max_cpc', 1, 0, null)
      invalidateRelatedCaches()

      return NextResponse.json({
        success: true,
        message: `成功更新广告系列的最大CPC限制为 ${newCpc}`,
        newCpc: newCpc,
      })
    } else if (biddingStrategyType === 'TARGET_CPA') {
      // Target CPA: 更新目标CPA
      // 🔧 修复(2026-03-07): 确保micros值是10000的倍数（Google Ads计费单位要求）
      const cpaMicros = Math.round(newCpc * 100) * 10000

      const campaignOperation = {
        update: {
          resource_name: `customers/${adsAccountRow.customer_id}/campaigns/${campaignId}`,
          target_cpa: {
            target_cpa_micros: cpaMicros,
          },
        },
        update_mask: 'target_cpa.target_cpa_micros',
      }

      // 更新广告系列
      await mutateResources(
        customer,
        useServiceAccount,
        'campaign',
        [campaignOperation],
        numericUserId,
        serviceAccountId,
        adsAccountRow.customer_id,
        requestId
      )

      await recordHistory('target_cpa', 1, 0, null)
      invalidateRelatedCaches()

      return NextResponse.json({
        success: true,
        message: `成功更新广告系列的目标CPA为 ${newCpc}`,
        newCpa: newCpc,
      })
    } else {
      return NextResponse.json(
        {
          error: `不支持的竞价策略类型: ${biddingStrategyType}`,
          supportedStrategies: ['MANUAL_CPC', 'TARGET_SPEND', 'MAXIMIZE_CLICKS', 'TARGET_CPA'],
        },
        { status: 400 }
      )
    }
  } catch (error: any) {
    console.error('更新CPC失败:', error)

    return NextResponse.json(
      {
        error: error.message || '更新CPC失败',
      },
      { status: 500 }
    )
  }
}
