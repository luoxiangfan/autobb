import { type Customer, enums } from 'google-ads-api'
import { gadsApiCache, generateGadsApiCacheKey } from '../../cache'
import { sanitizeGoogleAdsFinalUrlSuffix } from '@/lib/google-ads/common/ad-text'
import { oauthGetCustomerParams } from '@/lib/google-ads/oauth/customer-params'
import type { OAuthApiCredentialsFields } from '@/lib/google-ads/accounts/auth/index'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'
import { ApiOperationType } from '@/lib/google-ads/api/tracker'
import { withRetry } from '../../retry'
import { trackOAuthApiCall } from './shared'
import { getCustomerWithCredentials, resolveGoogleAdsApiCallAuth } from './customer'
import {
  createCampaignBudget,
  escapeGaqlStringLiteral,
  formatCampaignDateTimeForMutate,
  getGeoTargetConstantId,
  getLanguageConstantId,
  isDuplicateCampaignNameError,
  normalizeCampaignDateFields,
} from './campaign-helpers'
import { googleAdsApiLogger } from '@/lib/google-ads/common/logger'

export async function findGoogleAdsCampaignByName(params: {
  customerId: string
  refreshToken: string
  campaignName: string
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  customer?: Customer
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<{ campaignId: string; resourceName: string } | null> {
  const nameLiteral = escapeGaqlStringLiteral(params.campaignName)
  const query = `
    SELECT
      campaign.id,
      campaign.resource_name,
      campaign.name,
      campaign.status
    FROM campaign
    WHERE campaign.name = '${nameLiteral}'
      AND campaign.status != 'REMOVED'
    LIMIT 1
  `

  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
  let results: any[]

  if (authType === 'service_account') {
    const { executeGAQLQueryPython } = await import('../../python-ads-client')
    const response = await executeGAQLQueryPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      query,
    })
    results = response.results || []
  } else {
    const customer =
      params.customer ||
      (await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext)))
    results = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.SEARCH,
      '/api/google-ads/query',
      () => customer.query(query)
    )
  }

  const row = results[0]
  const campaignId = row?.campaign?.id ? String(row.campaign.id) : ''
  const resourceName = row?.campaign?.resourceName
    ? String(row.campaign.resourceName)
    : row?.campaign?.resource_name
      ? String(row.campaign.resource_name)
      : ''
  if (!campaignId || !resourceName) return null
  return { campaignId, resourceName }
}

export async function createGoogleAdsCampaign(params: {
  customerId: string
  refreshToken: string
  campaignName: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  status: 'ENABLED' | 'PAUSED'
  biddingStrategy?: string
  cpcBidCeilingMicros?: number
  targetCountry?: string
  targetLanguage?: string
  finalUrlSuffix?: string
  startDate?: string
  endDate?: string
  accountId?: number
  userId: number // 改为必填
  loginCustomerId?: string // 🔥 经理账号ID（用于访问客户账号）
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<{ campaignId: string; resourceName: string }> {
  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
  const sanitizedFinalUrlSuffix =
    params.finalUrlSuffix && params.finalUrlSuffix.trim() !== ''
      ? sanitizeGoogleAdsFinalUrlSuffix(params.finalUrlSuffix)
      : ''

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    // ♻️ 幂等：如果同名Campaign已存在（常见于任务重试），直接复用避免报错/产生孤儿预算
    try {
      const existing = await findGoogleAdsCampaignByName({
        customerId: params.customerId,
        refreshToken: params.refreshToken,
        campaignName: params.campaignName,
        userId: params.userId,
        loginCustomerId: params.loginCustomerId,
        authType,
        serviceAccountId: params.serviceAccountId,
        authContext,
      })
      if (existing) {
        googleAdsApiLogger.info('campaign_reused', {
          campaignName: params.campaignName,
          campaignId: existing.campaignId,
        })
        return existing
      }
    } catch (lookupError: any) {
      googleAdsApiLogger.warn(
        'campaign_existence_check_failed',
        { message: lookupError?.message || String(lookupError) },
        lookupError
      )
    }

    const { createCampaignBudgetPython, createCampaignPython } =
      await import('../../python-ads-client')

    // 1. 创建预算
    const budgetResourceName = await createCampaignBudgetPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      name: `${params.campaignName} Budget ${Date.now()}`,
      amountMicros: params.budgetAmount * 1000000,
      deliveryMethod: params.budgetType === 'DAILY' ? 'STANDARD' : 'ACCELERATED',
    })

    // 2. 创建广告系列
    let campaignResourceName: string
    try {
      campaignResourceName = await createCampaignPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        name: params.campaignName,
        budgetResourceName,
        status: 'PAUSED',
        biddingStrategyType: 'TARGET_SPEND',
        cpcBidCeilingMicros: params.cpcBidCeilingMicros || 170000,
        targetCountry: params.targetCountry,
        targetLanguage: params.targetLanguage,
        startDate: params.startDate,
        endDate: params.endDate,
        finalUrlSuffix: sanitizedFinalUrlSuffix,
      })
    } catch (error: any) {
      if (isDuplicateCampaignNameError(error)) {
        const existing = await findGoogleAdsCampaignByName({
          customerId: params.customerId,
          refreshToken: params.refreshToken,
          campaignName: params.campaignName,
          userId: params.userId,
          loginCustomerId: params.loginCustomerId,
          authType,
          serviceAccountId: params.serviceAccountId,
          authContext,
        })
        if (existing) {
          googleAdsApiLogger.info('campaign_duplicate_reused', {
            campaignName: params.campaignName,
            campaignId: existing.campaignId,
          })
          return existing
        }
      }
      throw error
    }

    const campaignId = campaignResourceName.split('/').pop() || ''
    return { campaignId, resourceName: campaignResourceName }
  }

  // OAuth模式：使用原有逻辑
  const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

  // ♻️ 幂等：如果同名Campaign已存在（常见于任务重试），直接复用避免报错/产生孤儿预算
  try {
    const existing = await findGoogleAdsCampaignByName({
      customerId: params.customerId,
      refreshToken: params.refreshToken,
      campaignName: params.campaignName,
      userId: params.userId,
      loginCustomerId: params.loginCustomerId,
      authType,
      serviceAccountId: params.serviceAccountId,
      customer,
      authContext,
    })
    if (existing) {
      googleAdsApiLogger.info('campaign_reused', {
        campaignName: params.campaignName,
        campaignId: existing.campaignId,
      })
      return existing
    }
  } catch (lookupError: any) {
    googleAdsApiLogger.warn(
      'campaign_existence_check_failed',
      { message: lookupError?.message || String(lookupError) },
      lookupError
    )
  }

  // 1. 创建预算（添加时间戳避免重复名称）
  const budgetResourceName = await createCampaignBudget(customer, {
    name: `${params.campaignName} Budget ${Date.now()}`,
    amount: params.budgetAmount,
    deliveryMethod: params.budgetType === 'DAILY' ? 'STANDARD' : 'ACCELERATED',
    userId: params.userId,
    customerId: params.customerId,
  })

  // 2. 创建广告系列（遵循Google Ads API官方最佳实践）
  const campaign: any = {
    name: params.campaignName,
    // 官方推荐：创建时使用PAUSED状态，添加完定位和广告后再启用
    status: enums.CampaignStatus.PAUSED,
    advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
    // 🚀 修复(2025-12-18): 移除SEARCH_STANDARD子类型
    // SEARCH_STANDARD不是有效的枚举值，标准搜索广告不需要设置子类型
    // advertising_channel_sub_type会默认为标准搜索广告
    campaign_budget: budgetResourceName,
    network_settings: {
      target_google_search: true,
      target_search_network: true,
      // 禁用Display Expansion（只投放搜索网络）
      target_content_network: false,
      target_partner_search_network: false,
    },
  }

  // 🔧 修复(2025-12-30): 移除不兼容的字段
  // - final_url_expansion_opt_out: 仅支持Performance Max和AI Max Search，普通Search Campaign不支持
  // - goal_config_settings: Campaign对象中不存在此字段，应使用ConversionGoalCampaignConfig资源
  // 转化目标将使用账号级别的默认配置

  // 设置出价策略 - Maximize Clicks (TARGET_SPEND)
  // 根据业务规范：Bidding Strategy = Maximize Clicks，CPC Bid = 0.17 USD
  // 注意：Maximize Clicks在API中的枚举值是TARGET_SPEND
  campaign.bidding_strategy_type = enums.BiddingStrategyType.TARGET_SPEND
  campaign.target_spend = {
    cpc_bid_ceiling_micros: params.cpcBidCeilingMicros || 170000, // 默认0.17 USD
  }

  // 必填字段：EU政治广告状态声明
  // 大多数Campaign不包含政治广告，设置为DOES_NOT_CONTAIN
  campaign.contains_eu_political_advertising =
    enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING

  // 地理位置选项设置：PRESENCE = 所在地（只定位实际位于该地理位置的用户）
  // PRESENCE_OR_INTEREST = 所在地或兴趣（定位在该地或对该地感兴趣的用户）
  // 参考：https://developers.google.com/google-ads/api/reference/rpc/latest/PositiveGeoTargetTypeEnum.PositiveGeoTargetType
  campaign.geo_target_type_setting = {
    positive_geo_target_type: enums.PositiveGeoTargetType.PRESENCE,
  }

  // 添加Final URL Suffix（始终设置，即使为空）
  // Final URL Suffix用于在所有广告的最终URL后附加跟踪参数
  // 从推广链接重定向访问后提取的Final URL suffix
  // 即使为空也设置字段，确保在Google Ads界面中显示配置状态
  campaign.final_url_suffix = sanitizedFinalUrlSuffix

  if (campaign.final_url_suffix) {
    googleAdsApiLogger.debug('campaign_final_url_suffix_set', {
      finalUrlSuffix: campaign.final_url_suffix,
    })
  } else {
    googleAdsApiLogger.debug('campaign_final_url_suffix_empty')
  }

  // 3. 添加日期设置（Google Ads API v23: start_date/end_date => start_date_time/end_date_time）
  if (params.startDate) {
    ;(campaign as any).start_date_time = formatCampaignDateTimeForMutate(params.startDate)
  }

  if (params.endDate) {
    ;(campaign as any).end_date_time = formatCampaignDateTimeForMutate(params.endDate, true)
  }

  // 🚀 优化(2025-12-18): 简化日志输出，减少噪音
  // DEBUG: 完整的Campaign对象（仅在开发环境打印）
  if (process.env.NODE_ENV === 'development') {
    googleAdsApiLogger.debug('campaign_config', {
      name: campaign.name,
      strategy: campaign.bidding_strategy_type,
      budget: campaign.target_spend,
      country: params.targetCountry,
    })
  }

  let response
  try {
    response = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/campaign/create',
      () =>
        withRetry(() => customer.campaigns.create([campaign]), {
          maxRetries: 3,
          initialDelay: 1000,
          operationName: `Create Campaign: ${params.campaignName}`,
        })
    )
  } catch (error: any) {
    if (isDuplicateCampaignNameError(error)) {
      const existing = await findGoogleAdsCampaignByName({
        customerId: params.customerId,
        refreshToken: params.refreshToken,
        campaignName: params.campaignName,
        userId: params.userId,
        loginCustomerId: params.loginCustomerId,
        authType,
        serviceAccountId: params.serviceAccountId,
        customer,
        authContext,
      })
      if (existing) {
        googleAdsApiLogger.info('campaign_duplicate_reused', {
          campaignName: params.campaignName,
          campaignId: existing.campaignId,
        })
        return existing
      }
    }

    // 打印详细的错误信息，特别是location字段
    googleAdsApiLogger.error(
      'campaign_create_failed',
      {
        errorJson: JSON.stringify(error, null, 2),
      },
      error
    )

    if (error.errors && Array.isArray(error.errors)) {
      error.errors.forEach((err: any, index: number) => {
        googleAdsApiLogger.error('campaign_create_error_detail', {
          index: index + 1,
          message: err.message,
          errorCode: err.error_code,
          location: err.location ? JSON.stringify(err.location, null, 2) : undefined,
        })
      })
    }

    throw error
  }

  if (!response || !response.results || response.results.length === 0) {
    throw new Error('创建广告系列失败：无响应')
  }

  const result = response.results[0]
  const campaignId = result.resource_name?.split('/').pop() || ''
  const campaignResourceName = result.resource_name || ''

  googleAdsApiLogger.info('campaign_created', { campaignId, campaignResourceName })

  // 4. 添加地理位置和语言定位条件（必需）
  // 参考: https://developers.google.com/google-ads/api/docs/campaigns/search-campaigns/getting-started
  const criteriaOperations: any[] = []

  // 添加地理位置定位
  if (params.targetCountry) {
    const geoTargetConstantId = getGeoTargetConstantId(params.targetCountry)
    if (geoTargetConstantId) {
      criteriaOperations.push({
        campaign: campaignResourceName,
        location: {
          geo_target_constant: `geoTargetConstants/${geoTargetConstantId}`,
        },
      })
      googleAdsApiLogger.debug('campaign_geo_target_added', {
        targetCountry: params.targetCountry,
        geoTargetConstantId,
      })
    }
  }

  // 添加语言定位
  if (params.targetLanguage) {
    const languageConstantId = getLanguageConstantId(params.targetLanguage)
    if (languageConstantId) {
      criteriaOperations.push({
        campaign: campaignResourceName,
        language: {
          language_constant: `languageConstants/${languageConstantId}`,
        },
      })
      googleAdsApiLogger.debug('campaign_language_target_added', {
        targetLanguage: params.targetLanguage,
        languageConstantId,
      })
    } else {
      googleAdsApiLogger.warn('campaign_language_constant_not_found', {
        targetLanguage: params.targetLanguage,
      })
    }
  } else {
    googleAdsApiLogger.warn('campaign_target_language_missing')
  }

  // 批量创建定位条件
  if (criteriaOperations.length > 0) {
    try {
      await trackOAuthApiCall(
        params.userId,
        params.customerId,
        ApiOperationType.MUTATE,
        '/api/google-ads/campaign-criteria/create',
        () =>
          withRetry(() => customer.campaignCriteria.create(criteriaOperations), {
            maxRetries: 3,
            initialDelay: 1000,
            operationName: `Create Campaign Criteria for ${params.campaignName}`,
          })
      )
      googleAdsApiLogger.info('campaign_criteria_added', {
        count: criteriaOperations.length,
        campaignId,
      })
    } catch (error: any) {
      googleAdsApiLogger.error('campaign_criteria_failed', { campaignId }, error)
      // 如果定位条件创建失败，暂停已创建的Campaign以保持安全（避免删除触发风控）
      try {
        await trackOAuthApiCall(
          params.userId,
          params.customerId,
          ApiOperationType.MUTATE,
          '/api/google-ads/campaign/update',
          () =>
            customer.campaigns.update([
              {
                resource_name: campaignResourceName,
                status: enums.CampaignStatus.PAUSED,
              },
            ])
        )
        googleAdsApiLogger.info('campaign_paused_after_criteria_failure', { campaignId })
      } catch (rollbackError) {
        googleAdsApiLogger.error('campaign_pause_rollback_failed', { campaignId }, rollbackError)
      }
      throw new Error(`Campaign定位条件创建失败: ${error.message}`)
    }
  } else {
    googleAdsApiLogger.warn('campaign_targeting_missing')
  }

  // 清除Campaigns列表缓存（创建新Campaign后）
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId, params.userId)
  gadsApiCache.delete(listCacheKey)
  googleAdsApiLogger.debug('campaigns_list_cache_cleared', { customerId: params.customerId })

  return {
    campaignId,
    resourceName: campaignResourceName,
  }
}

/**
 * 更新Google Ads广告系列状态
 */
export async function updateGoogleAdsCampaignStatus(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
  accountId?: number
  userId: number
  loginCustomerId?: string
  // 🔧 修复(2025-12-25): 支持服务账号认证
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<void> {
  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
  const requestedStatus = params.status
  const effectiveStatus = requestedStatus === 'REMOVED' ? 'PAUSED' : requestedStatus
  if (requestedStatus === 'REMOVED') {
    googleAdsApiLogger.warn('campaign_remove_disabled_pausing', { campaignId: params.campaignId })
  }

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { updateCampaignStatusPython } = await import('../../python-ads-client')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    await updateCampaignStatusPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      status: effectiveStatus as 'ENABLED' | 'PAUSED' | 'REMOVED',
    })
  } else {
    const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`

    await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/campaign/update',
      () =>
        withRetry(
          () =>
            customer.campaigns.update([
              {
                resource_name: resourceName,
                status: enums.CampaignStatus[effectiveStatus],
              },
            ]),
          {
            maxRetries: 3,
            initialDelay: 1000,
            operationName: `Update Campaign Status: ${params.campaignId} -> ${effectiveStatus}`,
          }
        )
    )
  }

  // 清除相关缓存（更新状态后）
  const getCacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, params.userId, {
    campaignId: params.campaignId,
  })
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId, params.userId)

  gadsApiCache.delete(getCacheKey)
  gadsApiCache.delete(listCacheKey)
  googleAdsApiLogger.debug('campaign_cache_cleared', { campaignId: params.campaignId })
}

/**
 * 更新 Google Ads 广告系列名称
 */
export async function updateGoogleAdsCampaignName(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  name: string
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  accountParentMccId?: string | null
  oauthLoginCustomerIdHint?: string
  authContext?: GoogleAdsAuthContext
}): Promise<void> {
  const trimmedName = String(params.name || '').trim()
  if (!trimmedName) {
    throw new Error('广告系列名称不能为空')
  }

  const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`

  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
  if (authType === 'service_account') {
    const { updateCampaignPython } = await import('../../python-ads-client')
    await updateCampaignPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      name: trimmedName,
    })
  } else {
    const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

    await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/campaign/update',
      () =>
        withRetry(
          () =>
            customer.campaigns.update([
              {
                resource_name: resourceName,
                name: trimmedName,
              },
            ]),
          {
            maxRetries: 3,
            initialDelay: 1000,
            operationName: `Update Campaign Name: ${params.campaignId}`,
          }
        )
    )
  }

  const getCacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, params.userId, {
    campaignId: params.campaignId,
  })
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId, params.userId)

  gadsApiCache.delete(getCacheKey)
  gadsApiCache.delete(listCacheKey)
}

/**
 * 删除Google Ads广告系列
 */
export async function removeGoogleAdsCampaign(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  customer?: Customer
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<void> {
  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
  const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`

  if (authType === 'service_account') {
    const { removeCampaignPython } = await import('../../python-ads-client')
    await removeCampaignPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
    })
  } else {
    const customer =
      params.customer ??
      (await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext)))

    await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/campaign/remove',
      () =>
        withRetry(() => customer.campaigns.remove([resourceName]), {
          maxRetries: 3,
          initialDelay: 1000,
          operationName: `Remove Campaign: ${params.campaignId}`,
        })
    )
  }

  const getCacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, params.userId, {
    campaignId: params.campaignId,
  })
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId, params.userId)
  gadsApiCache.delete(getCacheKey)
  gadsApiCache.delete(listCacheKey)
  googleAdsApiLogger.debug('campaign_cache_cleared', { campaignId: params.campaignId })
}

/**
 * 更新Google Ads广告系列预算
 */
export async function updateGoogleAdsCampaignBudget(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<void> {
  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { updateCampaignBudgetPython } = await import('../../python-ads-client')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    await updateCampaignBudgetPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      budgetAmountMicros: params.budgetAmount * 1000000,
    })
  } else {
    const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

    // 1. 创建新的预算
    const budgetResourceName = await createCampaignBudget(customer, {
      name: `Budget ${params.campaignId} - ${Date.now()}`,
      amount: params.budgetAmount,
      deliveryMethod: params.budgetType === 'DAILY' ? 'STANDARD' : 'ACCELERATED',
      userId: params.userId,
      customerId: params.customerId,
    })

    // 2. 更新Campaign指向新预算
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`

    await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/campaign/update',
      () =>
        withRetry(
          () =>
            customer.campaigns.update([
              {
                resource_name: resourceName,
                campaign_budget: budgetResourceName,
              },
            ]),
          {
            maxRetries: 3,
            initialDelay: 1000,
            operationName: `Update Campaign Budget: ${params.campaignId} -> ${params.budgetAmount}`,
          }
        )
    )
  }

  // 清除相关缓存
  const getCacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, params.userId, {
    campaignId: params.campaignId,
  })
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId, params.userId)

  gadsApiCache.delete(getCacheKey)
  gadsApiCache.delete(listCacheKey)
  googleAdsApiLogger.debug('campaign_budget_cache_cleared', { campaignId: params.campaignId })
}

/**
 * 获取Google Ads广告系列详情
 */
export async function getGoogleAdsCampaign(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  accountId?: number
  userId: number
  skipCache?: boolean
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<any> {
  const cacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, params.userId, {
    campaignId: params.campaignId,
  })

  if (!params.skipCache) {
    const cached = gadsApiCache.get(cacheKey)
    if (cached) {
      googleAdsApiLogger.debug('campaign_cache_hit', { campaignId: params.campaignId })
      return cached
    }
  }

  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
  let results: any[]

  if (authType === 'service_account') {
    // Google Ads API v23 起：Campaign.start_date/end_date => start_date_time/end_date_time
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date_time,
        campaign.end_date_time,
        campaign_budget.amount_micros,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE campaign.id = ${params.campaignId}
    `

    const { executeGAQLQueryPython } = await import('../../python-ads-client')
    const result = await executeGAQLQueryPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      query,
    })
    results = normalizeCampaignDateFields(result.results || [])
  } else {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date_time,
        campaign.end_date_time,
        campaign_budget.amount_micros,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE campaign.id = ${params.campaignId}
    `

    const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))
    const rawResults = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.SEARCH,
      '/api/google-ads/query',
      () => customer.query(query)
    )
    results = normalizeCampaignDateFields(rawResults)
  }

  const result = results[0] || null

  if (result) {
    gadsApiCache.set(cacheKey, result)
    googleAdsApiLogger.debug('campaign_cache_set', { campaignId: params.campaignId })
  }

  return result
}

/**
 * 列出Google Ads账号下的所有广告系列
 */
export async function listGoogleAdsCampaigns(params: {
  customerId: string
  refreshToken: string
  accountId?: number
  userId: number
  skipCache?: boolean
  loginCustomerId?: string
  // 🔧 修复(2025-12-25): 支持服务账号认证
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<any[]> {
  // 生成缓存键
  const cacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId, params.userId)

  // 检查缓存（除非显式跳过）
  if (!params.skipCache) {
    const cached = gadsApiCache.get(cacheKey)
    if (cached) {
      googleAdsApiLogger.debug('campaigns_list_cache_hit', { customerId: params.customerId })
      return cached
    }
  }

  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { executeGAQLQueryPython } = await import('../../python-ads-client')
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date_time,
        campaign.end_date_time,
        campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `

    const response = await executeGAQLQueryPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      query,
    })

    const results = normalizeCampaignDateFields(response.results || [])

    // 缓存结果（30分钟TTL）
    gadsApiCache.set(cacheKey, results)
    googleAdsApiLogger.debug('campaigns_list_cache_set', {
      customerId: params.customerId,
      count: results.length,
    })

    return results
  }

  // OAuth模式
  const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date_time,
      campaign.end_date_time,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY campaign.name
  `

  const rawResults = await trackOAuthApiCall(
    params.userId,
    params.customerId,
    ApiOperationType.SEARCH,
    '/api/google-ads/query',
    () => customer.query(query)
  )
  const results = normalizeCampaignDateFields(rawResults)

  // 缓存结果（30分钟TTL）
  gadsApiCache.set(cacheKey, results)
  googleAdsApiLogger.debug('campaigns_list_cache_set', {
    customerId: params.customerId,
    count: results.length,
  })

  return results
}

export async function updateCampaignFinalUrlSuffix(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  finalUrlSuffix: string
  accountId?: number
  userId: number
  loginCustomerId?: string
  credentials?: OAuthApiCredentialsFields
  accountParentMccId?: string | null
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  authContext?: GoogleAdsAuthContext
}): Promise<void> {
  const sanitizedFinalUrlSuffix = sanitizeGoogleAdsFinalUrlSuffix(params.finalUrlSuffix)
  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
  // 🔧 修复(2025-01-03): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { updateCampaignFinalUrlSuffixPython } = await import('../../python-ads-client')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    await updateCampaignFinalUrlSuffixPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      finalUrlSuffix: sanitizedFinalUrlSuffix,
    })
  } else {
    const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`

    await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/campaign/update',
      () =>
        withRetry(
          () =>
            customer.campaigns.update([
              {
                resource_name: resourceName,
                final_url_suffix: sanitizedFinalUrlSuffix,
              },
            ]),
          {
            maxRetries: 3,
            initialDelay: 1000,
            operationName: `Update Campaign Final URL Suffix: ${params.campaignId}`,
          }
        )
    )
  }

  // 清除相关缓存
  const getCacheKey = generateGadsApiCacheKey('getCampaign', params.customerId, params.userId, {
    campaignId: params.campaignId,
  })
  const listCacheKey = generateGadsApiCacheKey('listCampaigns', params.customerId, params.userId)

  gadsApiCache.delete(getCacheKey)
  gadsApiCache.delete(listCacheKey)
  googleAdsApiLogger.debug('campaign_cache_cleared_final_url_suffix', {
    campaignId: params.campaignId,
  })
}
