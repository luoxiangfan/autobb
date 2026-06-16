import { oauthGetCustomerParams } from '@/lib/google-ads/oauth/customer-params'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'
import { ApiOperationType } from '@/lib/google-ads/api/tracker'
import { trackOAuthApiCall } from './shared'
import { getCustomerWithCredentials, resolveGoogleAdsApiCallAuth } from './customer'
import { googleAdsPerformanceLogger } from '@/lib/google-ads/common/logger'

export async function getCampaignPerformance(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  startDate: string
  endDate: string
  accountId: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  authContext?: GoogleAdsAuthContext
}): Promise<
  Array<{
    date: string
    impressions: number
    clicks: number
    conversions: number
    cost_micros: number
    ctr: number
    cpc_micros: number
    conversion_rate: number
  }>
> {
  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM campaign
    WHERE campaign.id = ${params.campaignId}
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY segments.date DESC
  `

  try {
    const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('../../campaign/server')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))
      response = await trackOAuthApiCall(
        params.userId,
        params.customerId,
        ApiOperationType.REPORT,
        '/api/google-ads/query',
        () => customer.query(query)
      )
    }

    const performanceData = response.map((row: any) => ({
      date: row.segments?.date || '',
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      conversions: row.metrics?.conversions || 0,
      cost_micros: row.metrics?.cost_micros || 0,
      ctr: row.metrics?.ctr || 0,
      cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000), // Convert to micros
      conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
    }))

    return performanceData
  } catch (error: any) {
    googleAdsPerformanceLogger.error('get_campaign_performance_failed', {}, error)
    throw new Error(`获取表现数据失败: ${error.message}`)
  }
}

/**
 * 获取Ad Group表现数据
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.adGroupId - Google Ads Ad Group ID
 * @param params.startDate - 开始日期 (YYYY-MM-DD)
 * @param params.endDate - 结束日期 (YYYY-MM-DD)
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns 每日表现数据数组
 */
export async function getAdGroupPerformance(params: {
  customerId: string
  refreshToken: string
  adGroupId: string
  startDate: string
  endDate: string
  accountId: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  authContext?: GoogleAdsAuthContext
}): Promise<
  Array<{
    date: string
    impressions: number
    clicks: number
    conversions: number
    cost_micros: number
    ctr: number
    cpc_micros: number
    conversion_rate: number
  }>
> {
  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM ad_group
    WHERE ad_group.id = ${params.adGroupId}
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY segments.date DESC
  `

  try {
    const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('../../campaign/server')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))
      response = await trackOAuthApiCall(
        params.userId,
        params.customerId,
        ApiOperationType.REPORT,
        '/api/google-ads/query',
        () => customer.query(query)
      )
    }

    const performanceData = response.map((row: any) => ({
      date: row.segments?.date || '',
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      conversions: row.metrics?.conversions || 0,
      cost_micros: row.metrics?.cost_micros || 0,
      ctr: row.metrics?.ctr || 0,
      cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000),
      conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
    }))

    return performanceData
  } catch (error: any) {
    googleAdsPerformanceLogger.error('get_ad_group_performance_failed', {}, error)
    throw new Error(`获取表现数据失败: ${error.message}`)
  }
}

/**
 * 获取Ad表现数据
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.adId - Google Ads Ad ID
 * @param params.startDate - 开始日期 (YYYY-MM-DD)
 * @param params.endDate - 结束日期 (YYYY-MM-DD)
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns 每日表现数据数组
 */
export async function getAdPerformance(params: {
  customerId: string
  refreshToken: string
  adId: string
  startDate: string
  endDate: string
  accountId: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  authContext?: GoogleAdsAuthContext
}): Promise<
  Array<{
    date: string
    impressions: number
    clicks: number
    conversions: number
    cost_micros: number
    ctr: number
    cpc_micros: number
    conversion_rate: number
  }>
> {
  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM ad_group_ad
    WHERE ad_group_ad.ad.id = ${params.adId}
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY segments.date DESC
  `

  try {
    const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('../../campaign/server')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))
      response = await trackOAuthApiCall(
        params.userId,
        params.customerId,
        ApiOperationType.REPORT,
        '/api/google-ads/query',
        () => customer.query(query)
      )
    }

    const performanceData = response.map((row: any) => ({
      date: row.segments?.date || '',
      impressions: row.metrics?.impressions || 0,
      clicks: row.metrics?.clicks || 0,
      conversions: row.metrics?.conversions || 0,
      cost_micros: row.metrics?.cost_micros || 0,
      ctr: row.metrics?.ctr || 0,
      cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000),
      conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
    }))

    return performanceData
  } catch (error: any) {
    googleAdsPerformanceLogger.error('get_ad_performance_failed', {}, error)
    throw new Error(`获取表现数据失败: ${error.message}`)
  }
}

/**
 * 批量获取多个Campaign的表现数据（汇总）
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.campaignIds - Google Ads Campaign IDs数组
 * @param params.startDate - 开始日期 (YYYY-MM-DD)
 * @param params.endDate - 结束日期 (YYYY-MM-DD)
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns Campaign ID到表现数据的映射
 */
export async function getBatchCampaignPerformance(params: {
  customerId: string
  refreshToken: string
  campaignIds: string[]
  startDate: string
  endDate: string
  accountId: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  authContext?: GoogleAdsAuthContext
}): Promise<
  Record<
    string,
    Array<{
      date: string
      impressions: number
      clicks: number
      conversions: number
      cost_micros: number
      ctr: number
      cpc_micros: number
      conversion_rate: number
    }>
  >
> {
  const campaignIdList = params.campaignIds.join(',')

  const query = `
    SELECT
      campaign.id,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions_from_interactions_rate
    FROM campaign
    WHERE campaign.id IN (${campaignIdList})
      AND segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'
    ORDER BY campaign.id, segments.date DESC
  `

  try {
    const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
    let response: any[]

    if (authType === 'service_account') {
      const { executeGAQLQueryPython } = await import('../../campaign/server')
      const result = await executeGAQLQueryPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        query,
      })
      response = result.results || []
    } else {
      const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))
      response = await trackOAuthApiCall(
        params.userId,
        params.customerId,
        ApiOperationType.REPORT,
        '/api/google-ads/query',
        () => customer.query(query)
      )
    }

    // Group by campaign ID
    const performanceByCampaign: Record<string, any[]> = {}

    response.forEach((row: any) => {
      const campaignId = row.campaign?.id?.toString() || ''

      if (!performanceByCampaign[campaignId]) {
        performanceByCampaign[campaignId] = []
      }

      performanceByCampaign[campaignId].push({
        date: row.segments?.date || '',
        impressions: row.metrics?.impressions || 0,
        clicks: row.metrics?.clicks || 0,
        conversions: row.metrics?.conversions || 0,
        cost_micros: row.metrics?.cost_micros || 0,
        ctr: row.metrics?.ctr || 0,
        cpc_micros: Math.round((row.metrics?.average_cpc || 0) * 1000000),
        conversion_rate: row.metrics?.conversions_from_interactions_rate || 0,
      })
    })

    return performanceByCampaign
  } catch (error: any) {
    googleAdsPerformanceLogger.error('batch_get_campaign_performance_failed', {}, error)
    throw new Error(`批量获取表现数据失败: ${error.message}`)
  }
}
