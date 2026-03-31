/**
 * Google Ads Performance Sync Service
 * 自动同步广告创意效果数据用于加分计算
 *
 * 支持两种认证方式：
 * 1. OAuth 2.0 (传统方式)
 * 2. 服务账号认证 (Service Account)
 */

import { getDatabase } from './db'
import { saveCreativePerformance, PerformanceData } from './bonus-score-calculator'
import { getGoogleAdsCredentials, getUserAuthType } from './google-ads-oauth'
import { getCustomerWithCredentials } from './google-ads-api'
import { getServiceAccountConfig } from './google-ads-service-account'
import { executeGAQLQueryPython } from './python-ads-client'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'

interface SyncResult {
  success: boolean
  syncedCount: number
  errors: string[]
  syncDate: string
}

/**
 * 同步单个广告创意的效果数据
 * 🔧 修复(2025-12-26): 使用统一客户端（支持 Python 代理）
 */
export async function syncCreativePerformance(
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
    const creative = await db.queryOne<any>(`
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
    `, [adCreativeId])

    if (!creative || !creative.google_campaign_id) {
      console.warn(`Creative ${adCreativeId} has no active campaign`)
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
      ? await executeGAQLQueryPython({ userId: numericUserId, serviceAccountId, customerId: customerID, query })
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
      console.warn(`No performance data found for campaign ${creative.google_campaign_id}`)
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
      conversionRate
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
    console.error(`Error syncing creative ${adCreativeId}:`, error)
    return false
  }
}

/**
 * 同步用户所有广告创意的效果数据
 * 🔧 修复(2025-12-26): 使用统一客户端（支持 Python 代理）
 */
export async function syncAllCreativesPerformance(
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
    const creatives = await db.query<any>(`
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
    `, [userId])

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
      syncDate
    }
  } catch (error) {
    errors.push(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return {
      success: false,
      syncedCount,
      errors,
      syncDate
    }
  }
}

/**
 * API endpoint helper - Sync performance for a specific user
 * 🔧 修复(2025-12-26): 使用统一客户端（自动选择 OAuth 或服务账号）
 */
export async function syncUserPerformanceData(userId: string): Promise<SyncResult> {
  try {
    const userIdNum = parseInt(userId)
    if (!userIdNum) {
      throw new Error('Invalid userId')
    }

    const db = await getDatabase()

    // 获取用户凭证
    const credentials = await getGoogleAdsCredentials(userIdNum)
    if (!credentials) {
      throw new Error('Google Ads credentials not configured. Please complete API configuration in Settings.')
    }

    if (!credentials.client_id || !credentials.client_secret || !credentials.developer_token) {
      throw new Error('Incomplete Google Ads credentials. Please complete API configuration in Settings.')
    }

    // 检查是否配置了服务账号
    const serviceAccount = await getServiceAccountConfig(userIdNum)
    const auth = await getUserAuthType(userIdNum)

    // 🔧 PostgreSQL兼容性修复: is_active在PostgreSQL中是BOOLEAN类型
    const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

    // Get user's Google Ads account
    const account = await db.queryOne<any>(`
      SELECT customer_id
      FROM google_ads_accounts
      WHERE user_id = ? AND ${isActiveCondition}
      LIMIT 1
    `, [userId])

    if (!account) {
      throw new Error('No active Google Ads account found')
    }

    let loginCustomerId: string | undefined
    if (auth.authType === 'service_account') {
      loginCustomerId = serviceAccount?.mccCustomerId ? String(serviceAccount.mccCustomerId) : undefined
    } else {
      loginCustomerId = credentials.login_customer_id ? String(credentials.login_customer_id) : undefined
    }

    // 使用统一入口获取 Customer 实例（自动选择 OAuth 或服务账号）
    const customer = await getCustomerWithCredentials({
      customerId: account.customer_id,
      refreshToken: credentials.refresh_token || '',
      accountId: account.id,
      userId: userIdNum,
      loginCustomerId,
      authType: auth.authType,
      serviceAccountId: auth.serviceAccountId,
    })

    return await syncAllCreativesPerformance(
      userId,
      customer,
      account.customer_id,
      auth.authType === 'service_account',
      auth.serviceAccountId
    )
  } catch (error) {
    return {
      success: false,
      syncedCount: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      syncDate: new Date().toISOString().split('T')[0]
    }
  }
}
