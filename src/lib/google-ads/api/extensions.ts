import { enums } from 'google-ads-api'
import {
  sanitizeGoogleAdsAdText,
  sanitizeGoogleAdsFinalUrlSuffix,
} from '@/lib/google-ads/common/ad-text'
import { oauthGetCustomerParams } from '@/lib/google-ads/oauth/customer-params'
import type { OAuthApiCredentialsFields } from '@/lib/google-ads/accounts/auth/index'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'
import { ApiOperationType } from '@/lib/google-ads/api/tracker'
import { trackOAuthApiCall } from './shared'
import { getCustomerWithCredentials, resolveGoogleAdsApiCallAuth } from './customer'
import { googleAdsApiLogger } from '@/lib/google-ads/common/logger'
import { withRetry } from '../../common/server'

export async function createGoogleAdsCalloutExtensions(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  callouts: string[]
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<{ assetIds: string[] }> {
  try {
    const normalizedCallouts = Array.from(
      new Set(
        params.callouts
          .filter((text): text is string => typeof text === 'string')
          .map((text) => sanitizeGoogleAdsAdText(text, 25))
          .map((text) => text.trim())
          .filter((text) => text.length > 0)
      )
    )

    if (normalizedCallouts.length === 0) {
      throw new Error('没有有效的Callout文本，无法创建Callout扩展')
    }

    const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
    // 服务账号模式使用Python服务
    if (authType === 'service_account') {
      const { createCalloutExtensionsPython } = await import('../../campaign/server')
      const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
      const assetResourceNames = await createCalloutExtensionsPython({
        userId: params.userId,
        serviceAccountId: params.serviceAccountId,
        customerId: params.customerId,
        campaignResourceName: resourceName,
        calloutTexts: normalizedCallouts,
      })
      return { assetIds: assetResourceNames.map((rn) => rn.split('/').pop() || '') }
    }

    const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

    const assetIds: string[] = []
    const assetResourceNames: string[] = []

    // Step 1: Create Callout Assets
    const assetOperations = normalizedCallouts.map((calloutText) => ({
      callout_asset: {
        // normalizedCallouts 已经过 sanitizeGoogleAdsAdText(..., 25) 处理
        callout_text: calloutText,
      },
    }))

    googleAdsApiLogger.info('callout_assets_create_start', { count: normalizedCallouts.length })
    const assetResponse = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE_BATCH,
      '/api/google-ads/assets/create',
      () => customer.assets.create(assetOperations)
    )

    if (assetResponse && assetResponse.results) {
      assetResponse.results.forEach((result: any) => {
        const resourceName = result.resource_name || result.resourceName
        if (!resourceName) {
          googleAdsApiLogger.warn('callout_asset_missing_resource_name', { result })
          return
        }
        assetResourceNames.push(resourceName)
        const assetId = resourceName.split('/').pop() || ''
        if (assetId) assetIds.push(assetId)
      })
      googleAdsApiLogger.info('callout_assets_created', { count: assetIds.length })
    }

    if (assetResourceNames.length === 0) {
      throw new Error('Callout Assets创建结果为空，无法继续关联到Campaign')
    }

    // Step 2: Link Assets to Campaign
    const campaignAssetOperations = assetResourceNames.map((resourceName) => ({
      campaign: `customers/${params.customerId}/campaigns/${params.campaignId}`,
      asset: resourceName,
      field_type: enums.AssetFieldType.CALLOUT,
    }))

    googleAdsApiLogger.info('callout_assets_link_start', { campaignId: params.campaignId })
    const linkResponse = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE_BATCH,
      '/api/google-ads/campaign-assets/create',
      () => customer.campaignAssets.create(campaignAssetOperations, { partial_failure: true })
    )
    const partialFailure =
      linkResponse?.partial_failure_error ||
      (linkResponse as { partialFailureError?: unknown } | undefined)?.partialFailureError
    if (partialFailure) {
      googleAdsApiLogger.warn('callout_assets_partial_failure', { partialFailure })
    }
    googleAdsApiLogger.info('callout_assets_linked', { campaignId: params.campaignId })

    return { assetIds }
  } catch (error: any) {
    const errorMessage =
      error?.errors?.[0]?.message ||
      error?.error?.message ||
      error?.message ||
      (typeof error === 'string' ? error : 'Unknown error')
    let errorDetails = ''
    try {
      errorDetails = JSON.stringify(error, null, 2)
    } catch {
      errorDetails = String(error)
    }
    googleAdsApiLogger.error(
      'callout_extensions_create_failed',
      { errorMessage, errorDetails },
      error
    )
    throw new Error(`创建Callout扩展失败: ${errorMessage}`)
  }
}

/**
 * 创建Sitelink扩展（现在称为Sitelink Assets）
 *
 * @param params.customerId - Google Ads Customer ID
 * @param params.refreshToken - OAuth refresh token
 * @param params.campaignId - Campaign ID to attach sitelinks to
 * @param params.sitelinks - Array of sitelink objects
 * @param params.accountId - 本地账号ID
 * @param params.userId - 用户ID
 * @returns Array of created asset IDs
 */
export async function createGoogleAdsSitelinkExtensions(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  sitelinks: Array<{
    text: string
    url: string
    finalUrlSuffix?: string
    description1?: string
    description2?: string
  }>
  accountId?: number
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<{ assetIds: string[]; assetResourceNames: string[] }> {
  const sanitizedSitelinks = params.sitelinks.map((sitelink) => {
    const sanitizedText = sanitizeGoogleAdsAdText(sitelink.text, 25).trim()
    const desc1Raw = sitelink.description1
      ? sanitizeGoogleAdsAdText(sitelink.description1, 35).trim()
      : ''
    const desc2Raw = sitelink.description2
      ? sanitizeGoogleAdsAdText(sitelink.description2, 35).trim()
      : ''
    const finalUrlSuffix =
      sitelink.finalUrlSuffix && sitelink.finalUrlSuffix.trim()
        ? sanitizeGoogleAdsFinalUrlSuffix(sitelink.finalUrlSuffix)
        : undefined

    let description1: string | undefined = desc1Raw
    let description2: string | undefined = desc2Raw
    if (description1) {
      if (!description2) description2 = description1
    } else {
      description1 = undefined
      description2 = undefined
    }

    return {
      ...sitelink,
      text: sanitizedText,
      description1,
      description2,
      finalUrlSuffix,
    }
  })

  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)
  // 服务账号模式使用Python服务
  if (authType === 'service_account') {
    const { createSitelinkExtensionsPython } = await import('../../campaign/server')
    const resourceName = `customers/${params.customerId}/campaigns/${params.campaignId}`
    const assetResourceNames = await createSitelinkExtensionsPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      campaignResourceName: resourceName,
      sitelinks: sanitizedSitelinks.map((sl) => ({
        linkText: sl.text,
        finalUrl: sl.url,
        finalUrlSuffix: sl.finalUrlSuffix,
        description1: sl.description1,
        description2: sl.description2,
      })),
    })
    return {
      assetIds: assetResourceNames.map((rn) => rn.split('/').pop() || ''),
      assetResourceNames,
    }
  }

  const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

  const assetIds: string[] = []
  const assetResourceNames: string[] = []

  try {
    // Step 1: Create Sitelink Assets
    const assetOperations = sanitizedSitelinks.map((sitelink) => {
      googleAdsApiLogger.debug('sitelink_processing', {
        text: sitelink.text,
        url: sitelink.url,
        description1: sitelink.description1,
      })

      const sitelinkAsset: any = {
        // sanitizedSitelinks 已经过 sanitizeGoogleAdsAdText(..., 25) 处理
        link_text: sitelink.text,
      }

      // description1 和 description2 必须要么都存在，要么都不存在
      if (sitelink.description1 && sitelink.description1.trim()) {
        const desc1 = sitelink.description1
        const desc2 = sitelink.description2 || sitelink.description1
        sitelinkAsset.description1 = desc1
        sitelinkAsset.description2 = desc2
      }

      // 关键final_urls必须在Asset层级，不是sitelink_asset内部
      const assetObj: Record<string, unknown> = {
        sitelink_asset: sitelinkAsset,
        final_urls: [sitelink.url],
      }
      if (sitelink.finalUrlSuffix) {
        assetObj.final_url_suffix = sitelink.finalUrlSuffix
      }

      googleAdsApiLogger.debug('sitelink_asset_built', { assetObj })

      return assetObj
    })

    googleAdsApiLogger.info('sitelink_assets_create_start', {
      count: params.sitelinks.length,
      assetOperations,
    })
    const assetResponse = await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE_BATCH,
      '/api/google-ads/assets/create',
      () => customer.assets.create(assetOperations)
    )

    if (assetResponse && assetResponse.results) {
      assetResponse.results.forEach((result: any) => {
        const resourceName = result.resource_name || result.resourceName
        if (!resourceName) return
        assetResourceNames.push(resourceName)
        const assetId = resourceName.split('/').pop() || ''
        if (assetId) assetIds.push(assetId)
      })
      googleAdsApiLogger.info('sitelink_assets_created', { count: assetIds.length })
    }

    // Step 2: Link Assets to Campaign
    const campaignAssetOperations = assetIds.map((assetId) => ({
      campaign: `customers/${params.customerId}/campaigns/${params.campaignId}`,
      asset: `customers/${params.customerId}/assets/${assetId}`,
      field_type: enums.AssetFieldType.SITELINK,
    }))

    googleAdsApiLogger.info('sitelink_assets_link_start', { campaignId: params.campaignId })
    await trackOAuthApiCall(
      params.userId,
      params.customerId,
      ApiOperationType.MUTATE_BATCH,
      '/api/google-ads/campaign-assets/create',
      () => customer.campaignAssets.create(campaignAssetOperations)
    )
    googleAdsApiLogger.info('sitelink_assets_linked', { campaignId: params.campaignId })

    return { assetIds, assetResourceNames }
  } catch (error: any) {
    const errorMessage =
      error?.errors?.[0]?.message ||
      error?.error?.message ||
      error?.message ||
      (typeof error === 'string' ? error : 'Unknown error')
    let errorDetails = ''
    try {
      errorDetails = JSON.stringify(error, null, 2)
    } catch {
      errorDetails = String(error)
    }
    googleAdsApiLogger.error(
      'sitelink_extensions_create_failed',
      { errorMessage, errorDetails },
      error
    )
    throw new Error(`创建Sitelink扩展失败: ${errorMessage}`)
  }
}

/**
 * 更新 Sitelink Asset 的 Final URL Suffix（用于换链接任务）
 */
export async function updateAssetFinalUrlSuffix(params: {
  customerId: string
  refreshToken: string
  assetResourceName: string
  finalUrlSuffix: string
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  accountParentMccId?: string | null
  authContext?: GoogleAdsAuthContext
}): Promise<void> {
  const sanitizedFinalUrlSuffix = sanitizeGoogleAdsFinalUrlSuffix(params.finalUrlSuffix)
  const { authType, authContext } = await resolveGoogleAdsApiCallAuth(params)

  if (authType === 'service_account') {
    const { updateAssetFinalUrlSuffixPython } = await import('../../campaign/server')
    await updateAssetFinalUrlSuffixPython({
      userId: params.userId,
      serviceAccountId: params.serviceAccountId,
      customerId: params.customerId,
      assetResourceName: params.assetResourceName,
      finalUrlSuffix: sanitizedFinalUrlSuffix,
    })
    return
  }

  const customer = await getCustomerWithCredentials(oauthGetCustomerParams(params, authContext))

  await trackOAuthApiCall(
    params.userId,
    params.customerId,
    ApiOperationType.MUTATE,
    '/api/google-ads/asset/update-final-url-suffix',
    () =>
      withRetry(
        () =>
          customer.assets.update([
            {
              resource_name: params.assetResourceName,
              final_url_suffix: sanitizedFinalUrlSuffix,
            },
          ]),
        {
          maxRetries: 3,
          initialDelay: 1000,
          operationName: `Update Asset Final URL Suffix: ${params.assetResourceName}`,
        }
      )
  )

  googleAdsApiLogger.debug('asset_final_url_suffix_updated', {
    assetResourceName: params.assetResourceName,
  })
}
