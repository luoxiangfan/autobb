/**
 * Google Ads API集成 - Ad Strength实时验证
 *
 * 功能：
 * 1. 获取已发布广告的Ad Strength评级
 * 2. 获取Ad Strength改进建议（Recommendations API）
 * 3. 查询资产性能数据（Asset Performance）
 * 4. 验证创意是否符合EXCELLENT标准
 *
 * 依赖：使用现有的google-ads-api.ts OAuth基础设施
 */

import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB } from './google-ads-api'
import { getServiceAccountConfig } from './google-ads-service-account'
import { getDatabase } from './db'
import type { AdStrengthRating } from './ad-strength-evaluator'
import { executeGAQLQueryPython } from './python-ads-client'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'

/**
 * 获取Google Ads客户端（支持服务账号和OAuth两种模式）
 */
async function getGoogleAdsClient(
  customerId: string,
  userId: number
): Promise<{ customer: any; useServiceAccount: boolean; serviceAccountId?: string }> {
  const db = await getDatabase()

  // 获取账号信息（包含refresh_token和serviceAccountId）
  const account = await db.queryOne(
    `SELECT id, refresh_token, parent_mcc_id, service_account_id FROM google_ads_accounts
     WHERE user_id = ? AND customer_id = ?`,
    [userId, customerId]
  ) as any

  if (!account) {
    throw new Error('未找到Google Ads账号')
  }

  // 获取用户凭证（包含useServiceAccount标志）
  const credentials = await getGoogleAdsCredentialsFromDB(userId)

  // 判断使用服务账号还是OAuth认证
  const useServiceAccount = account.service_account_id && credentials.useServiceAccount

  if (useServiceAccount) {
    // 服务账号模式
    const config = await getServiceAccountConfig(userId, account.service_account_id)

    if (!config) {
      throw new Error('未找到服务账号配置')
    }

    const serviceAccountMccId = config.mccCustomerId ? String(config.mccCustomerId) : undefined

    return {
      customer: await getCustomerWithCredentials({
        customerId,
        accountId: account.id,
        userId,
        loginCustomerId: serviceAccountMccId || account.parent_mcc_id || undefined,
        authType: 'service_account',
        serviceAccountId: account.service_account_id,
      }),
      useServiceAccount: true,
      serviceAccountId: account.service_account_id
    }
  } else {
    // OAuth模式
    if (!account.refresh_token) {
      throw new Error('Google Ads账号缺少refresh token')
    }

    return {
      customer: await getCustomerWithCredentials({
        customerId,
        refreshToken: account.refresh_token,
        loginCustomerId: credentials.login_customer_id || account.parent_mcc_id || undefined,
        credentials: {
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          developer_token: credentials.developer_token,
        },
        accountId: account.id,
        userId,
      }),
      useServiceAccount: false
    }
  }
}

/**
 * Google Ads API Ad Strength响应
 */
export interface GoogleAdStrengthResponse {
  adGroupAdId: string
  adStrength: AdStrengthRating
  adStrengthInfo?: {
    adStrength: AdStrengthRating
    missingAssetTypes?: string[]
    policyViolations?: string[]
  }
}

/**
 * Ad Strength改进建议
 */
export interface AdStrengthRecommendation {
  resourceName: string
  type: 'RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH'
  impact: 'LOW' | 'MEDIUM' | 'HIGH'
  currentAdStrength: AdStrengthRating
  recommendedAdStrength: AdStrengthRating
  suggestions: {
    missingAssetTypes?: string[]
    assetCountRecommendation?: {
      currentHeadlineCount: number
      recommendedHeadlineCount: number
      currentDescriptionCount: number
      recommendedDescriptionCount: number
    }
    diversityIssues?: string[]
  }
}

/**
 * 资产性能数据
 */
export interface AssetPerformanceData {
  assetId: string
  assetType: 'HEADLINE' | 'DESCRIPTION'
  text: string
  performanceLabel: 'LEARNING' | 'LOW' | 'GOOD' | 'BEST'
  enabled: boolean
  impressions: number
  clicks: number
  ctr: number
}

async function executeOAuthQueryWithTracking(params: {
  userId: number
  customerId: string
  customer: any
  query: string
  operationType?: ApiOperationType
}): Promise<any[]> {
  const startTime = Date.now()
  try {
    const results = await params.customer.query(params.query)
    await trackApiUsage({
      userId: params.userId,
      operationType: params.operationType || ApiOperationType.REPORT,
      endpoint: '/api/google-ads/query',
      customerId: params.customerId,
      requestCount: 1,
      responseTimeMs: Date.now() - startTime,
      isSuccess: true,
    })
    return results
  } catch (error: any) {
    await trackApiUsage({
      userId: params.userId,
      operationType: params.operationType || ApiOperationType.REPORT,
      endpoint: '/api/google-ads/query',
      customerId: params.customerId,
      requestCount: 1,
      responseTimeMs: Date.now() - startTime,
      isSuccess: false,
      errorMessage: error?.message || String(error),
    }).catch(() => {})
    throw error
  }
}

/**
 * 1. 获取已发布广告的Ad Strength评级
 *
 * @param customerId Google Ads客户ID
 * @param campaignId Campaign ID
 * @param userId 用户ID（用于获取refresh_token）
 */
export async function getAdStrength(
  customerId: string,
  campaignId: string,
  userId: number
): Promise<GoogleAdStrengthResponse | null> {
  try {
    // 使用统一的客户端获取方法（支持服务账号和OAuth）
    const { customer, useServiceAccount, serviceAccountId } = await getGoogleAdsClient(customerId, userId)

    // GAQL查询：获取Ad Strength
    const query = `
      SELECT
        ad_group_ad.ad.id,
        ad_group_ad.ad.responsive_search_ad.ad_strength,
        ad_group_ad.policy_summary.approval_status
      FROM ad_group_ad
      WHERE campaign.id = ${campaignId}
        AND ad_group_ad.status = 'ENABLED'
        AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
      LIMIT 1
    `

    const results = useServiceAccount
      ? await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query })
      : await executeOAuthQueryWithTracking({
        userId,
        customerId,
        customer,
        query,
        operationType: ApiOperationType.REPORT,
      })

    if (results.length === 0) {
      console.log('⚠️ 未找到已发布的响应式搜索广告')
      return null
    }

    const ad = results[0]
    if (!ad.ad_group_ad?.ad?.id) {
      console.log('⚠️ 广告数据不完整')
      return null
    }

    const adId = ad.ad_group_ad.ad.id
    const adData = ad as any
    const adStrength = adData.ad_group_ad?.ad?.responsive_search_ad?.ad_strength || 'PENDING'

    console.log(`📊 Google Ads Ad Strength: ${adStrength} (Ad ID: ${adId})`)

    return {
      adGroupAdId: adId.toString(),
      adStrength: adStrength as AdStrengthRating,
      adStrengthInfo: {
        adStrength: adStrength as AdStrengthRating,
        policyViolations: []
      }
    }
  } catch (error) {
    console.error('❌ 获取Ad Strength失败:', error)
    throw error
  }
}

/**
 * 2. 获取Ad Strength改进建议（Recommendations API）
 *
 * @param customerId Google Ads客户ID
 * @param userId 用户ID
 */
export async function getAdStrengthRecommendations(
  customerId: string,
  userId: number
): Promise<AdStrengthRecommendation[]> {
  try {
    // 使用统一的客户端获取方法（支持服务账号和OAuth）
    const { customer, useServiceAccount, serviceAccountId } = await getGoogleAdsClient(customerId, userId)

    // GAQL查询：获取Ad Strength改进建议
    const query = `
      SELECT
        recommendation.resource_name,
        recommendation.type,
        recommendation.impact,
        recommendation.responsive_search_ad_improve_ad_strength_recommendation.current_ad_strength,
        recommendation.responsive_search_ad_improve_ad_strength_recommendation.recommended_ad_strength
      FROM recommendation
      WHERE recommendation.type = 'RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH'
        AND recommendation.dismissed = FALSE
      ORDER BY recommendation.impact DESC
      LIMIT 10
    `

    const results = useServiceAccount
      ? await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query })
      : await executeOAuthQueryWithTracking({
        userId,
        customerId,
        customer,
        query,
        operationType: ApiOperationType.REPORT,
      })

    const recommendations: AdStrengthRecommendation[] = results.map((rec: any) => {
      const recData = rec.recommendation.responsive_search_ad_improve_ad_strength_recommendation

      return {
        resourceName: rec.recommendation.resource_name,
        type: 'RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH',
        impact: rec.recommendation.impact,
        currentAdStrength: recData?.current_ad_strength || 'PENDING',
        recommendedAdStrength: recData?.recommended_ad_strength || 'EXCELLENT',
        suggestions: {
          missingAssetTypes: [],
          diversityIssues: []
        }
      }
    })

    console.log(`💡 找到 ${recommendations.length} 条Ad Strength改进建议`)

    return recommendations
  } catch (error) {
    console.error('❌ 获取Ad Strength建议失败:', error)
    return []
  }
}

/**
 * 3. 查询资产性能数据（Asset Field Type View）
 *
 * @param customerId Google Ads客户ID
 * @param campaignId Campaign ID
 * @param userId 用户ID
 */
export async function getAssetPerformance(
  customerId: string,
  campaignId: string,
  userId: number
): Promise<AssetPerformanceData[]> {
  try {
    // 使用统一的客户端获取方法（支持服务账号和OAuth）
    const { customer, useServiceAccount, serviceAccountId } = await getGoogleAdsClient(customerId, userId)

    // GAQL查询：获取资产性能（Headline和Description）
    const query = `
      SELECT
        asset.id,
        asset.type,
        asset.text_asset.text,
        asset_field_type_view.field_type,
        asset_field_type_view.performance_label,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr
      FROM asset_field_type_view
      WHERE campaign.id = ${campaignId}
        AND asset.type IN ('TEXT', 'CALLOUT', 'SITELINK')
        AND asset_field_type_view.field_type IN ('HEADLINE', 'DESCRIPTION')
      ORDER BY metrics.impressions DESC
      LIMIT 50
    `

    const results = useServiceAccount
      ? await executeGAQLQueryPython({ userId, serviceAccountId, customerId, query })
      : await executeOAuthQueryWithTracking({
        userId,
        customerId,
        customer,
        query,
        operationType: ApiOperationType.REPORT,
      })

    const assetPerformance: AssetPerformanceData[] = results.map((row: any) => ({
      assetId: row.asset.id.toString(),
      assetType: row.asset_field_type_view.field_type,
      text: row.asset.text_asset?.text || '',
      performanceLabel: row.asset_field_type_view.performance_label || 'LEARNING',
      enabled: true,
      impressions: parseInt(row.metrics.impressions || '0'),
      clicks: parseInt(row.metrics.clicks || '0'),
      ctr: parseFloat(row.metrics.ctr || '0')
    }))

    console.log(`📈 获取到 ${assetPerformance.length} 个资产的性能数据`)

    return assetPerformance
  } catch (error) {
    console.error('❌ 获取资产性能失败:', error)
    return []
  }
}

/**
 * 4. 验证创意是否符合EXCELLENT标准（综合判断）
 *
 * @param customerId Google Ads客户ID
 * @param campaignId Campaign ID
 * @param userId 用户ID
 */
export async function validateExcellentStandard(
  customerId: string,
  campaignId: string,
  userId: number
): Promise<{
  isExcellent: boolean
  currentStrength: AdStrengthRating
  recommendations: string[]
  assetPerformance: {
    bestHeadlines: string[]
    bestDescriptions: string[]
    lowPerformingAssets: string[]
  }
}> {
  try {
    // 1. 获取Ad Strength评级
    const strengthData = await getAdStrength(customerId, campaignId, userId)
    const currentStrength = strengthData?.adStrength || 'PENDING'

    // 2. 获取改进建议
    const recommendations = await getAdStrengthRecommendations(customerId, userId)

    // 3. 获取资产性能
    const assetPerformance = await getAssetPerformance(customerId, campaignId, userId)

    // 4. 分析资产性能
    const bestHeadlines = assetPerformance
      .filter(a => a.assetType === 'HEADLINE' && a.performanceLabel === 'BEST')
      .map(a => a.text)
      .slice(0, 5)

    const bestDescriptions = assetPerformance
      .filter(a => a.assetType === 'DESCRIPTION' && a.performanceLabel === 'BEST')
      .map(a => a.text)
      .slice(0, 2)

    const lowPerformingAssets = assetPerformance
      .filter(a => a.performanceLabel === 'LOW')
      .map(a => `${a.assetType}: ${a.text}`)

    // 5. 生成建议摘要
    const suggestionSummary = recommendations.map(rec =>
      `${rec.impact}影响: 当前${rec.currentAdStrength} → 推荐${rec.recommendedAdStrength}`
    )

    const isExcellent = currentStrength === 'EXCELLENT'

    console.log(`
🎯 Ad Strength验证结果:
- 当前评级: ${currentStrength}
- 是否EXCELLENT: ${isExcellent ? '✅ 是' : '❌ 否'}
- 改进建议数: ${recommendations.length}
- 最佳Headlines: ${bestHeadlines.length}个
- 最佳Descriptions: ${bestDescriptions.length}个
- 低性能资产: ${lowPerformingAssets.length}个
    `)

    return {
      isExcellent,
      currentStrength,
      recommendations: suggestionSummary,
      assetPerformance: {
        bestHeadlines,
        bestDescriptions,
        lowPerformingAssets
      }
    }
  } catch (error) {
    console.error('❌ 验证EXCELLENT标准失败:', error)
    throw error
  }
}

/**
 * 5. 批量验证多个Campaign的Ad Strength
 *
 * @param customerId Google Ads客户ID
 * @param campaignIds Campaign ID列表
 * @param userId 用户ID
 */
export async function batchValidateAdStrength(
  customerId: string,
  campaignIds: string[],
  userId: number
): Promise<Map<string, GoogleAdStrengthResponse | null>> {
  const results = new Map<string, GoogleAdStrengthResponse | null>()

  for (const campaignId of campaignIds) {
    try {
      const strengthData = await getAdStrength(customerId, campaignId, userId)
      results.set(campaignId, strengthData)
    } catch (error) {
      console.error(`❌ Campaign ${campaignId} Ad Strength获取失败:`, error)
      results.set(campaignId, null)
    }
  }

  return results
}
