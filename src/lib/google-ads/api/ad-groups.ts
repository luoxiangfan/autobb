import { enums, type Customer } from 'google-ads-api'
import { oauthGetCustomerParams } from '@/lib/google-ads/oauth/customer-params'
import type { OAuthApiCredentialsFields } from '@/lib/google-ads/accounts/auth/index'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'
import { ApiOperationType } from '@/lib/google-ads/api/tracker'
import { trackOAuthApiCall } from './shared'
import { getCustomerWithCredentials, resolveGoogleAdsApiCallAuth } from './customer'
import { escapeGaqlStringLiteral } from './campaign-helpers'

export async function findGoogleAdsAdGroupByName(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  adGroupName: string
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  customer?: Customer
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<{ adGroupId: string; resourceName: string } | null> {
  const nameLiteral = escapeGaqlStringLiteral(params.adGroupName)
  const query = `
    SELECT
      ad_group.id,
      ad_group.resource_name,
      ad_group.name,
      ad_group.status
    FROM ad_group
    WHERE ad_group.campaign = 'customers/${params.customerId}/campaigns/${params.campaignId}'
      AND ad_group.name = '${nameLiteral}'
      AND ad_group.status != 'REMOVED'
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
  const adGroupId = String(row?.ad_group?.id || row?.adGroup?.id || '').trim()
  if (!adGroupId) return null

  const resourceName = String(
    row?.ad_group?.resource_name ||
      row?.adGroup?.resourceName ||
      `customers/${params.customerId}/adGroups/${adGroupId}`
  ).trim()

  return { adGroupId, resourceName }
}

function isDuplicateAdGroupNameError(error: any): boolean {
  const errors = error?.errors
  if (!Array.isArray(errors)) return false
  return errors.some((entry: any) => {
    const code = entry?.error_code?.ad_group_error
    return code === 'DUPLICATE_ADGROUP_NAME' || code === 3
  })
}

/**
 * 创建Google Ads Ad Group
 */
export async function createGoogleAdsAdGroup(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  adGroupName: string
  cpcBidMicros?: number
  status: 'ENABLED' | 'PAUSED'
  accountId?: number
  userId: number
  loginCustomerId?: string // 🔥 经理账号ID
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<{ adGroupId: string; resourceName: string }> {
  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)

  const reuseExistingAdGroup = async (): Promise<{
    adGroupId: string
    resourceName: string
  } | null> => {
    try {
      return await findGoogleAdsAdGroupByName({
        customerId: params.customerId,
        refreshToken: params.refreshToken,
        campaignId: params.campaignId,
        adGroupName: params.adGroupName,
        userId: params.userId,
        loginCustomerId: params.loginCustomerId,
        authType,
        serviceAccountId: params.serviceAccountId,
        credentials: params.credentials,
        authContext,
      })
    } catch (lookupError: any) {
      console.warn(
        `⚠️ Ad Group存在性检查失败，将继续尝试创建: ${lookupError?.message || lookupError}`
      )
      return null
    }
  }

  // 🔧 修复(2025-12-26): 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const existing = await reuseExistingAdGroup()
    if (existing) {
      console.log(`♻️ 复用已存在的Ad Group: ${params.adGroupName} (ID=${existing.adGroupId})`)
      return existing
    }

    const { createAdGroupPython } = await import('../../python-ads-client')

    const campaignResourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    let adGroupResourceName: string
    try {
      adGroupResourceName = await createAdGroupPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        campaignResourceName,
        name: params.adGroupName,
        status: params.status,
        cpcBidMicros: params.cpcBidMicros,
      })
    } catch (error: any) {
      if (isDuplicateAdGroupNameError(error)) {
        const duplicate = await reuseExistingAdGroup()
        if (duplicate) {
          console.log(
            `♻️ Ad Group名称重复，复用已存在的Ad Group: ${params.adGroupName} (ID=${duplicate.adGroupId})`
          )
          return duplicate
        }
      }
      throw error
    }

    const adGroupId = adGroupResourceName.split('/').pop() || ''
    return { adGroupId, resourceName: adGroupResourceName }
  }

  // OAuth模式：使用原有逻辑
  const existing = await reuseExistingAdGroup()
  if (existing) {
    console.log(`♻️ 复用已存在的Ad Group: ${params.adGroupName} (ID=${existing.adGroupId})`)
    return existing
  }

  const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

  const adGroup = {
    name: params.adGroupName,
    campaign: `customers/${params.customerId}/campaigns/${params.campaignId}`,
    status: enums.AdGroupStatus[params.status],
    type: enums.AdGroupType.SEARCH_STANDARD,
  }

  // 如果提供了CPC出价，设置手动CPC
  if (params.cpcBidMicros) {
    ;(adGroup as any).cpc_bid_micros = params.cpcBidMicros
  }

  try {
    const response = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE,
      '/api/google-ads/ad-group/create',
      () => customer.adGroups.create([adGroup])
    )

    if (!response || !response.results || response.results.length === 0) {
      throw new Error('创建Ad Group失败：无响应')
    }

    const result = response.results[0]
    const adGroupId = result.resource_name?.split('/').pop() || ''

    return {
      adGroupId,
      resourceName: result.resource_name || '',
    }
  } catch (error: any) {
    if (isDuplicateAdGroupNameError(error)) {
      const duplicate = await reuseExistingAdGroup()
      if (duplicate) {
        console.log(
          `♻️ Ad Group名称重复，复用已存在的Ad Group: ${params.adGroupName} (ID=${duplicate.adGroupId})`
        )
        return duplicate
      }
    }
    throw error
  }
}
