/**
 * Google Ads 创建服务
 * 
 * 功能：
 * 1. 通过 Google Ads API 创建广告系列
 * 2. 通过 Google Ads API 创建广告组
 * 3. 通过 Google Ads API 创建广告
 * 4. 通过 Google Ads API 创建关键词
 * 
 * @module google-ads-create
 */

import { getCustomerWithCredentials, getGoogleAdsCredentialsFromDB } from './google-ads-api'
import { getDatabase } from './db'

/**
 * 创建广告系列请求
 */
export interface CreateCampaignRequest {
  userId: number
  customerId: string
  campaignName: string
  budgetAmount: number
  budgetType: 'DAILY' | 'TOTAL'
  biddingStrategy?: string
  marketingObjective?: string
  startDate?: string
  endDate?: string
  status?: 'ENABLED' | 'PAUSED'
}

/**
 * 创建广告组请求
 */
export interface CreateAdGroupRequest {
  userId: number
  customerId: string
  campaignId: string  // Google Ads campaign resource name
  adGroupName: string
  maxCpcBid?: number
}

/**
 * 创建广告请求
 */
export interface CreateAdRequest {
  userId: number
  customerId: string
  adGroupId: string  // Google Ads ad group resource name
  headlines: string[]
  descriptions: string[]
  finalUrls: string[]
  callouts?: string[]
  sitelinks?: Array<{
    text: string
    url: string
    description?: string
  }>
}

/**
 * 创建关键词请求
 */
export interface CreateKeywordRequest {
  userId: number
  customerId: string
  adGroupId: string  // Google Ads ad group resource name
  keywords: Array<{
    text: string
    matchType: 'EXACT' | 'PHRASE' | 'BROAD'
    cpcBid?: number
  }>
}

/**
 * 创建结果
 */
export interface CreateResult {
  success: boolean
  campaignId?: string  // Google Ads campaign resource name
  adGroupId?: string   // Google Ads ad group resource name
  adIds?: string[]     // Google Ads ad resource names
  keywordIds?: string[] // Google Ads keyword resource names
  errors?: Array<{
    type: string
    message: string
  }>
}

/**
 * 通过 Google Ads API 创建完整的广告系列（包含广告组、广告、关键词）
 */
export async function createCampaignToGoogleAds(
  userId: number,
  customerId: string,
  campaignConfig: any
): Promise<CreateResult> {
  const result: CreateResult = {
    success: false,
  }

  try {
    // 1. 创建广告系列
    const campaignResult = await createCampaignToGoogle({
      userId,
      customerId,
      campaignName: campaignConfig.campaignName,
      budgetAmount: campaignConfig.budgetAmount,
      budgetType: campaignConfig.budgetType,
      biddingStrategy: campaignConfig.biddingStrategy,
      marketingObjective: campaignConfig.marketingObjective,
      startDate: campaignConfig.startDate,
      endDate: campaignConfig.endDate,
      status: 'PAUSED',  // 初始状态为暂停
    })

    if (!campaignResult.success || !campaignResult.campaignId) {
      result.errors = campaignResult.errors
      return result
    }

    result.campaignId = campaignResult.campaignId

    // 2. 创建广告组
    if (campaignConfig.adGroupName) {
      const adGroupResult = await createAdGroupToGoogle({
        userId,
        customerId,
        campaignId: campaignResult.campaignId,
        adGroupName: campaignConfig.adGroupName,
        maxCpcBid: campaignConfig.maxCpcBid,
      })

      if (!adGroupResult.success || !adGroupResult.adGroupId) {
        result.errors = adGroupResult.errors
        return result
      }

      result.adGroupId = adGroupResult.adGroupId

      // 3. 创建广告
      if (campaignConfig.headlines && campaignConfig.headlines.length > 0) {
        const adResult = await createAdToGoogle({
          userId,
          customerId,
          adGroupId: adGroupResult.adGroupId,
          headlines: campaignConfig.headlines,
          descriptions: campaignConfig.descriptions || [],
          finalUrls: campaignConfig.finalUrls || [],
          callouts: campaignConfig.callouts,
          sitelinks: campaignConfig.sitelinks,
        })

        if (adResult.success) {
          result.adIds = adResult.adIds
        }
      }

      // 4. 创建关键词
      if (campaignConfig.keywords && campaignConfig.keywords.length > 0) {
        const keywordResult = await createKeywordsToGoogle({
          userId,
          customerId,
          adGroupId: adGroupResult.adGroupId,
          keywords: campaignConfig.keywords,
        })

        if (keywordResult.success) {
          result.keywordIds = keywordResult.keywordIds
        }
      }

      // 5. 创建否定关键词
      if (campaignConfig.negativeKeywords && campaignConfig.negativeKeywords.length > 0) {
        await createNegativeKeywordsToGoogle({
          userId,
          customerId,
          campaignId: campaignResult.campaignId,
          adGroupId: adGroupResult.adGroupId,
          negativeKeywords: campaignConfig.negativeKeywords,
          negativeKeywordMatchType: campaignConfig.negativeKeywordMatchType,
        })
      }
    }

    result.success = true
    console.log(`[Google Ads Create] Created campaign ${campaignResult.campaignId} for user ${userId}`)
  } catch (error: any) {
    console.error('[Google Ads Create] Error:', error)
    result.errors = [{
      type: 'general',
      message: error.message,
    }]
  }

  return result
}

/**
 * 通过 Google Ads API 创建广告系列
 */
export async function createCampaignToGoogle(params: CreateCampaignRequest): Promise<CreateResult> {
  try {
    // 🔧 调用 Python 服务创建广告系列
    const response = await fetch(process.env.GOOGLE_ADS_CREATE_CAMPAIGN_URL || 'http://localhost:8000/create-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: params.userId,
        customer_id: params.customerId,
        campaign_name: params.campaignName,
        budget_amount: params.budgetAmount,
        budget_type: params.budgetType,
        bidding_strategy: params.biddingStrategy,
        marketing_objective: params.marketingObjective,
        start_date: params.startDate,
        end_date: params.endDate,
        status: params.status,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      return {
        success: false,
        errors: [{
          type: 'api',
          message: error.message || '创建广告系列失败',
        }],
      }
    }

    const data = await response.json()
    return {
      success: true,
      campaignId: data.campaign_resource_name,
    }
  } catch (error: any) {
    console.error('[Create Campaign] Error:', error)
    return {
      success: false,
      errors: [{
        type: 'error',
        message: error.message,
      }],
    }
  }
}

/**
 * 通过 Google Ads API 创建广告组
 */
export async function createAdGroupToGoogle(params: CreateAdGroupRequest): Promise<CreateResult> {
  try {
    const response = await fetch(process.env.GOOGLE_ADS_CREATE_ADGROUP_URL || 'http://localhost:8000/create-ad-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: params.userId,
        customer_id: params.customerId,
        campaign_id: params.campaignId,
        ad_group_name: params.adGroupName,
        max_cpc_bid: params.maxCpcBid,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      return {
        success: false,
        errors: [{
          type: 'api',
          message: error.message || '创建广告组失败',
        }],
      }
    }

    const data = await response.json()
    return {
      success: true,
      adGroupId: data.ad_group_resource_name,
    }
  } catch (error: any) {
    console.error('[Create Ad Group] Error:', error)
    return {
      success: false,
      errors: [{
        type: 'error',
        message: error.message,
      }],
    }
  }
}

/**
 * 通过 Google Ads API 创建广告
 */
export async function createAdToGoogle(params: CreateAdRequest): Promise<CreateResult> {
  try {
    const response = await fetch(process.env.GOOGLE_ADS_CREATE_AD_URL || 'http://localhost:8000/create-ad', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: params.userId,
        customer_id: params.customerId,
        ad_group_id: params.adGroupId,
        headlines: params.headlines,
        descriptions: params.descriptions,
        final_urls: params.finalUrls,
        callouts: params.callouts,
        sitelinks: params.sitelinks,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      return {
        success: false,
        errors: [{
          type: 'api',
          message: error.message || '创建广告失败',
        }],
      }
    }

    const data = await response.json()
    return {
      success: true,
      adIds: data.ad_resource_names,
    }
  } catch (error: any) {
    console.error('[Create Ad] Error:', error)
    return {
      success: false,
      errors: [{
        type: 'error',
        message: error.message,
      }],
    }
  }
}

/**
 * 通过 Google Ads API 创建关键词
 */
export async function createKeywordsToGoogle(params: CreateKeywordRequest): Promise<CreateResult> {
  try {
    const response = await fetch(process.env.GOOGLE_ADS_CREATE_KEYWORD_URL || 'http://localhost:8000/create-keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: params.userId,
        customer_id: params.customerId,
        ad_group_id: params.adGroupId,
        keywords: params.keywords,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      return {
        success: false,
        errors: [{
          type: 'api',
          message: error.message || '创建关键词失败',
        }],
      }
    }

    const data = await response.json()
    return {
      success: true,
      keywordIds: data.keyword_resource_names,
    }
  } catch (error: any) {
    console.error('[Create Keywords] Error:', error)
    return {
      success: false,
      errors: [{
        type: 'error',
        message: error.message,
      }],
    }
  }
}

/**
 * 通过 Google Ads API 创建否定关键词
 */
export async function createNegativeKeywordsToGoogle(params: {
  userId: number
  customerId: string
  campaignId: string
  adGroupId: string
  negativeKeywords: string[]
  negativeKeywordMatchType?: { [key: string]: string }
}): Promise<void> {
  try {
    const negativeKeywords = params.negativeKeywords.map(text => ({
      text,
      matchType: params.negativeKeywordMatchType?.[text] || 'BROAD',
    }))

    // 创建广告系列级别的否定关键词
    const campaignResponse = await fetch(process.env.GOOGLE_ADS_CREATE_NEGATIVE_KEYWORD_URL || 'http://localhost:8000/create-negative-keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: params.userId,
        customer_id: params.customerId,
        campaign_id: params.campaignId,
        negative_keywords: negativeKeywords,
      }),
    })

    if (!campaignResponse.ok) {
      console.error('[Create Campaign Negative Keywords] Failed')
    }

    // 创建广告组级别的否定关键词
    const adGroupResponse = await fetch(process.env.GOOGLE_ADS_CREATE_NEGATIVE_KEYWORD_URL || 'http://localhost:8000/create-negative-keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: params.userId,
        customer_id: params.customerId,
        ad_group_id: params.adGroupId,
        negative_keywords: negativeKeywords,
      }),
    })

    if (!adGroupResponse.ok) {
      console.error('[Create Ad Group Negative Keywords] Failed')
    }
  } catch (error: any) {
    console.error('[Create Negative Keywords] Error:', error)
  }
}
