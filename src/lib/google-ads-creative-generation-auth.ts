import { getGoogleAdsConfig } from './keyword-planner'
import {
  clearGoogleAdsLinkedAccountPrepareCache,
  createGoogleAdsLinkedAccountPrepareCache,
  prepareGoogleAdsApiCallForLinkedAccountCached,
} from './google-ads-api-prepare'
import { resolveGoogleAdsCredentialOwnerId } from './google-ads-auth-assignment'
import { getGoogleAdsAuthContextGenerationForHydrate } from './google-ads-auth-context'
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

function sharedOwnerGenerationFields(
  userId: number,
  ownerUserId: number
): Pick<CreativeGenerationValidationCacheEntry, 'ownerUserId' | 'ownerGenerationAtValidate'> {
  if (ownerUserId === userId) {
    return {}
  }
  return {
    ownerUserId,
    ownerGenerationAtValidate: getGoogleAdsAuthContextGenerationForHydrate(ownerUserId),
  }
}

function toValidationCacheEntry(
  userId: number,
  ownerUserId: number,
  result: CreativeGenerationGoogleAdsValidationResult
): CreativeGenerationValidationCacheEntry {
  const generationAtValidate = getGoogleAdsAuthContextGenerationForHydrate(userId)
  const ownerFields = sharedOwnerGenerationFields(userId, ownerUserId)
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      authType: result.authType,
      missingFields: result.missingFields,
      generationAtValidate,
      ...ownerFields,
    }
  }
  return { ok: true, generationAtValidate, ...ownerFields }
}

function isValidationCacheEntryCurrent(
  userId: number,
  entry: CreativeGenerationValidationCacheEntry
): boolean {
  if (entry.generationAtValidate !== getGoogleAdsAuthContextGenerationForHydrate(userId)) {
    return false
  }
  if (
    entry.ownerUserId != null &&
    entry.ownerGenerationAtValidate != null &&
    entry.ownerUserId !== userId
  ) {
    return (
      entry.ownerGenerationAtValidate ===
      getGoogleAdsAuthContextGenerationForHydrate(entry.ownerUserId)
    )
  }
  return true
}

function validationResultFromCacheEntry(
  entry: CreativeGenerationValidationCacheEntry
): CreativeGenerationGoogleAdsValidationResult {
  if (!entry.ok) {
    return {
      ok: false,
      message: entry.message,
      authType: entry.authType,
      missingFields: entry.missingFields,
    }
  }
  return { ok: true }
}

async function resolveOwnerUserIdForValidationCache(
  userId: number,
  result: CreativeGenerationGoogleAdsValidationResult,
  ownerUserIdHint?: number
): Promise<number> {
  if (ownerUserIdHint != null) {
    return ownerUserIdHint
  }
  if (result.ok && result.authContext) {
    return result.authContext.ownerUserId
  }
  const { ownerUserId } = await resolveGoogleAdsCredentialOwnerId(userId)
  return ownerUserId
}

async function validateGoogleAdsConfigForCreativeGenerationInternal(
  userId: number,
  offerId: number | undefined,
  cache?: CreativeGenerationAuthCache
): Promise<{
  result: CreativeGenerationGoogleAdsValidationResult
  ownerUserId?: number
}> {
  const linkedSa =
    offerId != null ? await resolveLinkedServiceAccountIdForOffer(userId, offerId) : null

  const prepared = await prepareGoogleAdsApiCallForLinkedAccountCached(
    userId,
    linkedSa,
    cache
  )
  if (!prepared.ok) {
    return { result: { ok: false, message: prepared.message } }
  }

  const ownerUserId = prepared.authContext.ownerUserId
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
        result: {
          ok: false,
          message: '广告创意生成需要完整的 Google Ads API 配置',
          authType: apiAuth.authType,
          missingFields: [
            !googleAdsConfig?.developerToken && 'Developer Token',
            !googleAdsConfig?.customerId && 'MCC Customer ID',
          ].filter(Boolean) as string[],
        },
        ownerUserId,
      }
    }
    return { result: { ok: true, authContext, apiAuth }, ownerUserId }
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
      result: {
        ok: false,
        message: '广告创意生成需要完整的 Google Ads API 配置',
        authType: apiAuth.authType,
        missingFields: [
          !googleAdsConfig?.developerToken && 'Developer Token',
          !googleAdsConfig?.refreshToken && 'Refresh Token / OAuth',
          !oauthCustomerId && 'Customer ID',
        ].filter(Boolean) as string[],
      },
      ownerUserId,
    }
  }

  return { result: { ok: true, authContext, apiAuth }, ownerUserId }
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
    if (cachedOffer && isValidationCacheEntryCurrent(userId, cachedOffer)) {
      return validationResultFromCacheEntry(cachedOffer)
    }
    if (cachedOffer) {
      cache?.validationByOfferId.delete(offerId)
    }
  } else {
    const cachedUser = cache?.validationByUserId.get(userId)
    if (cachedUser && isValidationCacheEntryCurrent(userId, cachedUser)) {
      return validationResultFromCacheEntry(cachedUser)
    }
    if (cachedUser) {
      cache?.validationByUserId.delete(userId)
    }
  }

  const { result, ownerUserId: ownerUserIdHint } =
    await validateGoogleAdsConfigForCreativeGenerationInternal(userId, offerId, cache)

  const ownerUserId = await resolveOwnerUserIdForValidationCache(
    userId,
    result,
    ownerUserIdHint
  )
  const cacheEntry = toValidationCacheEntry(userId, ownerUserId, result)
  if (offerId != null) {
    cache?.validationByOfferId.set(offerId, cacheEntry)
  } else {
    cache?.validationByUserId.set(userId, cacheEntry)
  }

  return result
}
