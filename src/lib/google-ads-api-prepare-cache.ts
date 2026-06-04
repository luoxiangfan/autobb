import {
  stripGoogleAdsAuthContextForCache,
  seedHydratedSecretsCacheFromFullContext,
  invalidateHydratedSecretsCache,
} from './google-ads-auth-context-cache'
import { getGoogleAdsAuthContextGenerationForHydrate } from './google-ads-auth-context'
import type { GoogleAdsAuthContext } from './google-ads-auth-context'
import type {
  PreparedGoogleAdsAccountApiCall,
  SlimPreparedGoogleAdsAccountApiCall,
  GoogleAdsLinkedAccountPrepareCache,
} from './google-ads-accounts-auth-types'

export function stripPreparedGoogleAdsAccountApiCallForCache(
  prepared: { authContext: GoogleAdsAuthContext } & PreparedGoogleAdsAccountApiCall
): SlimPreparedGoogleAdsAccountApiCall {
  return {
    authContext: stripGoogleAdsAuthContextForCache(prepared.authContext),
    apiAuth: {
      ...prepared.apiAuth,
      refreshToken: '',
    },
    oauthLoginCustomerId: prepared.oauthLoginCustomerId,
  }
}

/** 首次 prepare 成功后种子化 secrets 短缓存，便于同 job 内 rehydrate 免重复查库 */
export function seedPrepareCacheHydratedSecrets(
  prepared: { authContext: GoogleAdsAuthContext } & PreparedGoogleAdsAccountApiCall
): void {
  seedHydratedSecretsCacheFromFullContext(
    prepared.authContext.userId,
    getGoogleAdsAuthContextGenerationForHydrate(prepared.authContext.userId),
    prepared.authContext
  )
}

/** job / 请求结束时显式释放 prepare 缓存及关联的 generation secrets 短缓存 */
export function clearGoogleAdsLinkedAccountPrepareCache(
  cache: GoogleAdsLinkedAccountPrepareCache
): void {
  for (const entry of cache.prepareByLinkedSa.values()) {
    invalidateHydratedSecretsCache(entry.authContext.userId)
  }
  cache.prepareByLinkedSa.clear()
}
