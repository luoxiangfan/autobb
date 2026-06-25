import {
  stripGoogleAdsAuthContextForCache,
  seedHydratedSecretsCacheFromFullContext,
} from '@/lib/google-ads/auth/context-cache'
import { getGoogleAdsAuthContextGenerationForHydrate } from '@/lib/google-ads/auth/context'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'
import type {
  PreparedGoogleAdsAccountApiCall,
  SlimPreparedGoogleAdsAccountApiCall,
  GoogleAdsLinkedAccountPrepareCache,
} from '@/lib/google-ads/accounts/auth/types'

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
    generationAtPrepare: getGoogleAdsAuthContextGenerationForHydrate(prepared.authContext.userId),
  }
}

/* * 首次 prepare 成功后种子化 secrets 短缓存，便于同 job 内 rehydrate 免重复查库 */
export function seedPrepareCacheHydratedSecrets(
  prepared: { authContext: GoogleAdsAuthContext } & PreparedGoogleAdsAccountApiCall
): void {
  seedHydratedSecretsCacheFromFullContext(
    prepared.authContext.userId,
    getGoogleAdsAuthContextGenerationForHydrate(prepared.authContext.userId),
    prepared.authContext
  )
}

/* * job / 请求结束时显式释放 prepare slim 缓存（不含密钥；不触碰进程级 secrets 短缓存） */
export function clearGoogleAdsLinkedAccountPrepareCache(
  cache: GoogleAdsLinkedAccountPrepareCache
): void {
  cache.prepareByLinkedSa.clear()
  cache.prepareInflight.clear()
  cache.healedOAuthBundleByOwner.clear()
}
