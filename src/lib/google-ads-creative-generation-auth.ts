import { getGoogleAdsConfig } from './keyword-planner'
import {
  clearGoogleAdsLinkedAccountPrepareCache,
  createGoogleAdsLinkedAccountPrepareCache,
  prepareGoogleAdsApiCallForLinkedAccountCached,
} from './google-ads-api-prepare'
import { resolveLinkedServiceAccountIdForOffer, queryGoogleAdsAccountForOfferExpand } from './google-ads-keyword-planner-auth'
import type {
  CreativeGenerationAuthCache,
  CreativeGenerationGoogleAdsValidationResult,
  CreativeGenerationValidationCacheEntry,
} from './google-ads-accounts-auth-types'

async function resolveOAuthCustomerIdForPlannerContext(
  userId: number,
  offerId: number | undefined,
  googleAdsConfig: Awaited<ReturnType<typeof getGoogleAdsConfig>>
): Promise<string | null> {
  if (offerId != null) {
    const adsAccount = await queryGoogleAdsAccountForOfferExpand(userId, offerId)
    const fromAccount = adsAccount?.customer_id?.trim()
    if (fromAccount) return fromAccount
  }
  const fromLogin =
    googleAdsConfig?.customerId?.trim() || googleAdsConfig?.loginCustomerId?.trim() || ''
  return fromLogin || null
}

function toValidationCacheEntry(
  result: CreativeGenerationGoogleAdsValidationResult
): CreativeGenerationValidationCacheEntry {
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      authType: result.authType,
      missingFields: result.missingFields,
    }
  }
  return { ok: true }
}

function validationResultFromCacheEntry(
  entry: CreativeGenerationValidationCacheEntry
): CreativeGenerationGoogleAdsValidationResult {
  if (!entry.ok) {
    return entry
  }
  return { ok: true }
}

async function validateGoogleAdsConfigForCreativeGenerationInternal(
  userId: number,
  offerId: number | undefined,
  cache?: CreativeGenerationAuthCache
): Promise<CreativeGenerationGoogleAdsValidationResult> {
  const linkedSa =
    offerId != null ? await resolveLinkedServiceAccountIdForOffer(userId, offerId) : null

  const prepared = await prepareGoogleAdsApiCallForLinkedAccountCached(
    userId,
    linkedSa,
    cache
  )
  if (!prepared.ok) {
    return { ok: false, message: prepared.message }
  }

  const { authContext, apiAuth } = prepared
  const googleAdsConfig = await getGoogleAdsConfig(
    userId,
    apiAuth.authType,
    apiAuth.serviceAccountId,
    authContext,
    prepared.oauthCredentials
      ? {
          credentials: prepared.oauthCredentials,
          loginCustomerId: prepared.oauthLoginCustomerId,
          refreshToken: prepared.refreshToken,
        }
      : undefined
  )

  if (apiAuth.authType === 'service_account') {
    const isConfigComplete = !!(googleAdsConfig?.developerToken && googleAdsConfig?.customerId)
    if (!isConfigComplete) {
      return {
        ok: false,
        message: '广告创意生成需要完整的 Google Ads API 配置',
        authType: apiAuth.authType,
        missingFields: [
          !googleAdsConfig?.developerToken && 'Developer Token',
          !googleAdsConfig?.customerId && 'MCC Customer ID',
        ].filter(Boolean) as string[],
      }
    }
    return { ok: true, authContext, apiAuth }
  }

  const oauthCustomerId = await resolveOAuthCustomerIdForPlannerContext(
    userId,
    offerId,
    googleAdsConfig
  )
  const isConfigComplete = !!(
    googleAdsConfig?.developerToken &&
    googleAdsConfig?.refreshToken &&
    oauthCustomerId
  )

  if (!isConfigComplete) {
    return {
      ok: false,
      message: '广告创意生成需要完整的 Google Ads API 配置',
      authType: apiAuth.authType,
      missingFields: [
        !googleAdsConfig?.developerToken && 'Developer Token',
        !googleAdsConfig?.refreshToken && 'Refresh Token / OAuth',
        !oauthCustomerId && 'Customer ID',
      ].filter(Boolean) as string[],
    }
  }

  return { ok: true, authContext, apiAuth }
}

export function createCreativeGenerationAuthCache(): CreativeGenerationAuthCache {
  return {
    ...createGoogleAdsLinkedAccountPrepareCache(),
    validationByOfferId: new Map(),
    validationByUserId: new Map(),
  }
}

/** job / 请求结束时显式释放创意生成 auth 缓存（含 prepare slim 与 validation） */
export function clearCreativeGenerationAuthCache(cache: CreativeGenerationAuthCache): void {
  clearGoogleAdsLinkedAccountPrepareCache(cache)
  cache.validationByOfferId.clear()
  cache.validationByUserId.clear()
}

export async function validateGoogleAdsConfigForCreativeGeneration(
  userId: number,
  offerId?: number,
  cache?: CreativeGenerationAuthCache
): Promise<CreativeGenerationGoogleAdsValidationResult> {
  if (offerId != null) {
    const cachedOffer = cache?.validationByOfferId.get(offerId)
    if (cachedOffer) {
      return validationResultFromCacheEntry(cachedOffer)
    }
  } else {
    const cachedUser = cache?.validationByUserId.get(userId)
    if (cachedUser) {
      return validationResultFromCacheEntry(cachedUser)
    }
  }

  const result = await validateGoogleAdsConfigForCreativeGenerationInternal(
    userId,
    offerId,
    cache
  )

  const cacheEntry = toValidationCacheEntry(result)
  if (offerId != null) {
    cache?.validationByOfferId.set(offerId, cacheEntry)
  } else {
    cache?.validationByUserId.set(userId, cacheEntry)
  }

  return result
}
