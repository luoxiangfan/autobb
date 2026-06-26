/**
 * Google Ads Performance Sync Service
 * 自动同步广告创意效果数据用于加分计算
 *
 * 支持两种认证方式
 * 1. OAuth 2.0 (传统方式)
 * 2. 服务账号认证 (Service Account)
 */

import { getDatabase } from '../../db'
import { saveCreativePerformance, PerformanceData } from '../../launch-score/server'
import { getCustomerWithCredentials } from '@/lib/google-ads/api/api'
import {
  prepareGoogleAdsApiCallForLinkedAccount,
  preparedAuthContextField,
} from '@/lib/google-ads/accounts/auth/index'
import { runWithLoginCustomerFallbackForAccount } from '@/lib/google-ads/oauth/login-customer'
import { executeGAQLQueryPython } from '../../campaign/server'
import { trackApiUsage, ApiOperationType } from '@/lib/google-ads/api/tracker'
import { googleAdsPerformanceLogger } from '@/lib/google-ads/common/logger'

interface SyncResult {
  success: boolean
  syncedCount: number
  errors: string[]
  syncDate: string
}

/**
 * 同步单个广告创意的效果数据
 * 使用统一客户端（支持 Python 代理）
 */
async function syncCreativePerformance(
  adCreativeId: number,
  userId: string,
  customer: any,
  customerID: string,
  useServiceAccount: boolean = false,
  serviceAccountId?: string
): Promise<boolean> {
  try {
    const db = await getDatabase()

    // 获取广告创意和关联的campaign/ad_group信息
    const creative = await db.queryOne<any>(
      `
      SELECT
        ac.id,
        ac.offer_id,
        c.google_campaign_id,
        c.id as campaign_id,
        o.industry_code
      FROM ad_creatives ac
      LEFT JOIN campaigns c ON ac.offer_id = c.offer_id AND c.status = 'ACTIVE'
      LEFT JOIN offers o ON ac.offer_id = o.id
      WHERE ac.id = ?
    `,
      [adCreativeId]
    )

    if (!creative || !creative.google_campaign_id) {
      googleAdsPerformanceLogger.warn('creative_no_active_campaign', { adCreativeId })
      return false
    }

    // 查询最近30天的效果数据
    const query = `
      SELECT
        campaign.id,
        ad_group.id,
        ad_group_ad.ad.id,
        metrics.clicks,
        metrics.impressions,
        metrics.ctr,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value
      FROM ad_group_ad
      WHERE
        campaign.id = '${creative.google_campaign_id}'
        AND segments.date DURING LAST_30_DAYS
        AND ad_group_ad.status = 'ENABLED'
    `

    const numericUserId = parseInt(userId, 10)
    const results = useServiceAccount
      ? await executeGAQLQueryPython({
          userId: numericUserId,
          serviceAccountId,
          customerId: customerID,
          query,
        })
      : await (async () => {
          const startTime = Date.now()
          try {
            const data = await customer.query(query)
            await trackApiUsage({
              userId: numericUserId,
              operationType: ApiOperationType.REPORT,
              endpoint: '/api/google-ads/query',
              customerId: customerID,
              requestCount: 1,
              responseTimeMs: Date.now() - startTime,
              isSuccess: true,
            })
            return data
          } catch (error: any) {
            await trackApiUsage({
              userId: numericUserId,
              operationType: ApiOperationType.REPORT,
              endpoint: '/api/google-ads/query',
              customerId: customerID,
              requestCount: 1,
              responseTimeMs: Date.now() - startTime,
              isSuccess: false,
              errorMessage: error?.message || String(error),
            }).catch(() => {})
            throw error
          }
        })()

    if (results.length === 0) {
      googleAdsPerformanceLogger.warn('no_performance_data', {
        googleCampaignId: creative.google_campaign_id,
      })
      return false
    }

    // 聚合所有结果
    let totalClicks = 0
    let totalImpressions = 0
    let totalCost = 0
    let totalConversions = 0

    for (const row of results) {
      totalClicks += row.metrics?.clicks || 0
      totalImpressions += row.metrics?.impressions || 0
      totalCost += (row.metrics?.cost_micros || 0) / 1000000 // Convert micros to dollars
      totalConversions += row.metrics?.conversions || 0
    }

    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
    const cpc = totalClicks > 0 ? totalCost / totalClicks : 0
    const conversionRate = totalClicks > 0 ? (totalConversions / totalClicks) * 100 : 0

    const performanceData: PerformanceData = {
      clicks: totalClicks,
      ctr,
      cpc,
      conversions: totalConversions,
      conversionRate,
    }

    // 保存到数据库并计算加分
    const industryCode = creative.industry_code || 'ecom_fashion'
    const syncDate = new Date().toISOString().split('T')[0]

    await saveCreativePerformance(
      adCreativeId,
      creative.offer_id,
      userId,
      performanceData,
      industryCode,
      syncDate
    )

    return true
  } catch (error) {
    googleAdsPerformanceLogger.error('sync_creative_failed', { adCreativeId }, error)
    return false
  }
}

/**
 * 同步用户所有广告创意的效果数据
 * 使用统一客户端（支持 Python 代理）
 */
async function syncAllCreativesPerformance(
  userId: string,
  customer: any,
  customerID: string,
  useServiceAccount: boolean = false,
  serviceAccountId?: string
): Promise<SyncResult> {
  const db = await getDatabase()
  const syncDate = new Date().toISOString().split('T')[0]
  const errors: string[] = []
  let syncedCount = 0

  try {
    // 获取所有有活跃campaign的ad creatives
    const creatives = await db.query<any>(
      `
      SELECT DISTINCT
        ac.id,
        ac.offer_id,
        o.user_id
      FROM ad_creatives ac
      JOIN offers o ON ac.offer_id = o.id
      JOIN campaigns c ON ac.offer_id = c.offer_id
      WHERE c.status = 'ACTIVE'
        AND o.user_id = ?
        AND c.google_campaign_id IS NOT NULL
    `,
      [userId]
    )

    for (const creative of creatives) {
      const success = await syncCreativePerformance(
        creative.id,
        userId,
        customer,
        customerID,
        useServiceAccount,
        serviceAccountId
      )

      if (success) {
        syncedCount++
      } else {
        errors.push(`Failed to sync creative ${creative.id}`)
      }
    }

    return {
      success: true,
      syncedCount,
      errors,
      syncDate,
    }
  } catch (error) {
    errors.push(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return {
      success: false,
      syncedCount,
      errors,
      syncDate,
    }
  }
}

/**
 * API endpoint helper - Sync performance for a specific user
 * 使用统一客户端（自动选择 OAuth 或服务账号）
 */
export async function syncUserPerformanceData(userId: string): Promise<SyncResult> {
  try {
    const userIdNum = parseInt(userId, 10)
    if (!userIdNum) {
      throw new Error('Invalid userId')
    }

    const db = await getDatabase()

    const account = await db.queryOne<{
      id: number
      customer_id: string
      parent_mcc_id: string | null
      service_account_id: string | null
    }>(
      `
      SELECT id, customer_id, parent_mcc_id, service_account_id
      FROM google_ads_accounts
      WHERE user_id = ? AND is_active = true
      LIMIT 1
    `,
      [userIdNum]
    )

    if (!account) {
      throw new Error('No active Google Ads account found')
    }

    const prepared = await prepareGoogleAdsApiCallForLinkedAccount(
      userIdNum,
      account.service_account_id
    )
    if (!prepared.ok) {
      throw new Error(prepared.message)
    }
    const apiAuth = prepared.apiAuth
    if (apiAuth.authType === 'service_account' && !apiAuth.serviceAccountId) {
      throw new Error('未找到服务账号配置，无法同步效果数据')
    }
    if (apiAuth.authType === 'oauth' && !prepared.refreshToken) {
      throw new Error('Missing refresh token. Please complete OAuth authorization in Settings.')
    }

    const oauthCredentials = prepared.oauthCredentials
    const oauthLoginCustomerId = prepared.oauthLoginCustomerId ?? apiAuth.oauthLoginCustomerId

    return await runWithLoginCustomerFallbackForAccount({
      adsAccount: {
        customer_id: account.customer_id,
        parent_mcc_id: account.parent_mcc_id,
        id: account.id,
      },
      refreshToken: prepared.refreshToken,
      authType: apiAuth.authType,
      serviceAccountId: apiAuth.serviceAccountId,
      serviceAccountMccId: apiAuth.serviceAccountMccId,
      oauthLoginCustomerId,
      actionName: 'syncAllCreativesPerformance',
      callback: async (loginCustomerId) => {
        const customer = await getCustomerWithCredentials({
          customerId: account.customer_id,
          refreshToken: prepared.refreshToken,
          accountId: account.id,
          userId: userIdNum,
          loginCustomerId,
          authType: apiAuth.authType,
          serviceAccountId: apiAuth.serviceAccountId,
          credentials: oauthCredentials,
          accountParentMccId: account.parent_mcc_id,
          oauthLoginCustomerIdHint: oauthLoginCustomerId,
          ...preparedAuthContextField(prepared),
        })

        return syncAllCreativesPerformance(
          userId,
          customer,
          account.customer_id,
          apiAuth.authType === 'service_account',
          apiAuth.serviceAccountId
        )
      },
    })
  } catch (error) {
    return {
      success: false,
      syncedCount: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      syncDate: new Date().toISOString().split('T')[0],
    }
  }
}
