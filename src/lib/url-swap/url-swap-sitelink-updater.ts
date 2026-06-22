/**
 * Url-swap Phase 2: update Sitelink Asset final_url_suffix from store_product_links.
 */
import { getDatabase } from '@/lib/db'
import { updateAssetFinalUrlSuffix } from '@/lib/google-ads/api/extensions'
import { runWithLoginCustomerFallbackForAccount } from '@/lib/google-ads/oauth/login-customer'
import {
  createGoogleAdsLinkedAccountPrepareCache,
  clearGoogleAdsLinkedAccountPrepareCache,
  prepareGoogleAdsApiCallForLinkedAccountCached,
  preparedAuthContextField,
  type GoogleAdsLinkedAccountPrepareCache,
} from '@/lib/google-ads/accounts/auth/index'
import type { OAuthApiCredentialsFields } from '@/lib/google-ads/accounts/auth/index'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'
import { validateUrlSwapDomainChange } from './url-swap-domain-validation'
import {
  resolveAffiliateLinkForUrlSwap,
  shouldRetryUrlSwapTargetOnSameSuffix,
} from './url-swap-resolve-config'
import type { SwapHistoryEntry, SwapHistorySitelinkUpdate } from './url-swap-types'
import {
  getActiveUrlSwapSitelinkTargets,
  loadOfferStoreProductLinksForUrlSwap,
  markUrlSwapSitelinkTargetFailure,
  markUrlSwapSitelinkTargetSuccess,
  type UrlSwapSitelinkTarget,
} from './url-swap-sitelink-targets'

export const URL_SWAP_SITELINK_ENABLED = process.env.URL_SWAP_SITELINK_ENABLED !== 'false'

type UrlSwapAccountMeta = {
  service_account_id: string | null
  parent_mcc_id: string | null
}

export interface UrlSwapSitelinkPhaseResult {
  enabled: boolean
  changed: boolean
  successCount: number
  failureCount: number
  skippedCount: number
  updates: SwapHistorySitelinkUpdate[]
}

async function resolveSitelinkAffiliateLink(params: {
  affiliateLink: string
  targetCountry: string
  userId: number
}) {
  return resolveAffiliateLinkForUrlSwap(params)
}

async function resolveSitelinkTargetApiAuth(params: {
  userId: number
  target: UrlSwapSitelinkTarget
  db: Awaited<ReturnType<typeof getDatabase>>
  accountMetaById: Map<number, UrlSwapAccountMeta>
  prepareCache: GoogleAdsLinkedAccountPrepareCache
}): Promise<{
  refreshToken: string
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
  oauthLoginCustomerId?: string
  serviceAccountMccId?: string
  parentMccId: string | null
  oauthCredentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}> {
  const accountId = params.target.google_ads_account_id
  if (!params.accountMetaById.has(accountId)) {
    const row = await params.db.queryOne<UrlSwapAccountMeta>(
      'SELECT service_account_id, parent_mcc_id FROM google_ads_accounts WHERE id = ? AND user_id = ?',
      [accountId, params.userId]
    )
    params.accountMetaById.set(accountId, {
      service_account_id: row?.service_account_id ?? null,
      parent_mcc_id: row?.parent_mcc_id ?? null,
    })
  }

  const accountMeta = params.accountMetaById.get(accountId)
  const linkedSa = accountMeta?.service_account_id ?? null
  const result = await prepareGoogleAdsApiCallForLinkedAccountCached(
    params.userId,
    linkedSa,
    params.prepareCache
  )
  if (!result.ok) {
    throw new Error(result.message)
  }

  return {
    refreshToken: result.refreshToken,
    authType: result.apiAuth.authType,
    serviceAccountId: result.apiAuth.serviceAccountId,
    oauthLoginCustomerId: result.oauthLoginCustomerId ?? result.apiAuth.oauthLoginCustomerId,
    serviceAccountMccId: result.apiAuth.serviceAccountMccId,
    parentMccId: accountMeta?.parent_mcc_id ?? null,
    oauthCredentials: result.oauthCredentials,
    ...preparedAuthContextField(result),
  }
}

async function updateSingleSitelinkAssetSuffix(params: {
  target: UrlSwapSitelinkTarget
  finalUrlSuffix: string
  userId: number
  refreshToken: string
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
  oauthLoginCustomerId?: string
  serviceAccountMccId?: string
  parentMccId?: string | null
  oauthCredentials?: OAuthApiCredentialsFields
  authContext?: GoogleAdsAuthContext
}): Promise<void> {
  await runWithLoginCustomerFallbackForAccount({
    adsAccount: {
      customer_id: params.target.google_customer_id,
      parent_mcc_id: params.parentMccId ?? null,
      id: params.target.google_ads_account_id,
    },
    refreshToken: params.refreshToken,
    authType: params.authType,
    serviceAccountId: params.serviceAccountId,
    serviceAccountMccId: params.serviceAccountMccId,
    oauthLoginCustomerId: params.oauthLoginCustomerId,
    actionName: `url-swap 更新 Sitelink Asset ${params.target.asset_id}`,
    callback: (loginCustomerId) =>
      updateAssetFinalUrlSuffix({
        customerId: params.target.google_customer_id,
        refreshToken: params.authType === 'oauth' ? params.refreshToken : '',
        assetResourceName: params.target.asset_resource_name,
        finalUrlSuffix: params.finalUrlSuffix,
        userId: params.userId,
        authType: params.authType,
        serviceAccountId:
          params.authType === 'service_account' ? params.serviceAccountId : undefined,
        loginCustomerId,
        credentials: params.oauthCredentials,
        accountParentMccId: params.parentMccId,
        authContext: params.authContext,
      }),
  })
}

export function emptyUrlSwapSitelinkPhaseResult(): UrlSwapSitelinkPhaseResult {
  return {
    enabled: URL_SWAP_SITELINK_ENABLED,
    changed: false,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    updates: [],
  }
}

/**
 * Store Offer：仅当本轮 Campaign suffix 已成功写入 Google Ads 时才更新 Sitelink。
 * 主链换链失败、未尝试更新、或全部目标更新失败时，跳过 Sitelink 阶段。
 */
export function shouldRunUrlSwapSitelinkPhase(params: {
  campaignUpdateAttempted: boolean
  campaignUpdateSuccessCount: number
}): boolean {
  if (!params.campaignUpdateAttempted) return false
  return params.campaignUpdateSuccessCount > 0
}

/**
 * 解析 store_product_links 并更新已映射 Sitelink Asset 的 final_url_suffix。
 */
export async function runUrlSwapSitelinkSuffixPhase(params: {
  taskId: string
  offerId: number
  userId: number
  targetCountry: string
  db?: Awaited<ReturnType<typeof getDatabase>>
}): Promise<UrlSwapSitelinkPhaseResult> {
  const emptyResult: UrlSwapSitelinkPhaseResult = {
    enabled: URL_SWAP_SITELINK_ENABLED,
    changed: false,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    updates: [],
  }

  if (!URL_SWAP_SITELINK_ENABLED) {
    return emptyResult
  }

  const db = params.db ?? (await getDatabase())
  const { pageType, storeProductLinks } = await loadOfferStoreProductLinksForUrlSwap(
    params.offerId,
    params.userId
  )
  if (pageType !== 'store' || storeProductLinks.length === 0) {
    return emptyResult
  }

  const sitelinkTargets = await getActiveUrlSwapSitelinkTargets(params.taskId, params.userId)
  if (sitelinkTargets.length === 0) {
    console.log(
      `[url-swap-sitelink] 无活跃 Sitelink 映射: task=${params.taskId}（请先发布 Sitelink 并确保已创建换链任务）`
    )
    return emptyResult
  }

  const accountMetaById = new Map<number, UrlSwapAccountMeta>()
  const prepareCache = createGoogleAdsLinkedAccountPrepareCache()

  const result: UrlSwapSitelinkPhaseResult = {
    enabled: true,
    changed: false,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    updates: [],
  }

  try {
    console.log(
      `[url-swap-sitelink] 开始更新 Sitelink suffix: task=${params.taskId}, targets=${sitelinkTargets.length}`
    )

    for (const target of sitelinkTargets) {
      const affiliateLink =
        storeProductLinks[target.sort_index]?.trim() || target.affiliate_link?.trim() || ''

      const baseUpdate: SwapHistorySitelinkUpdate = {
        sort_index: target.sort_index,
        asset_id: target.asset_id,
        link_text: target.link_text,
        previous_final_url_suffix: target.current_final_url_suffix || '',
        new_final_url_suffix: target.current_final_url_suffix || '',
        success: false,
      }

      if (!affiliateLink) {
        const message = `缺少 sort_index=${target.sort_index} 的联盟链接`
        await markUrlSwapSitelinkTargetFailure(target.id, message)
        result.failureCount++
        result.updates.push({ ...baseUpdate, success: false, error_message: message })
        continue
      }

      try {
        const resolved = await resolveSitelinkAffiliateLink({
          affiliateLink,
          targetCountry: params.targetCountry,
          userId: params.userId,
        })

        if (target.current_final_url) {
          const validation = validateUrlSwapDomainChange(
            target.current_final_url,
            resolved.finalUrl,
            'sitelink'
          )
          if (!validation.valid) {
            throw new Error(validation.error || 'Sitelink 域名校验失败')
          }
        }

        const suffixChanged = resolved.finalUrlSuffix !== (target.current_final_url_suffix ?? '')
        const shouldRetry = shouldRetryUrlSwapTargetOnSameSuffix(target)

        if (!suffixChanged && !shouldRetry) {
          result.skippedCount++
          result.updates.push({
            ...baseUpdate,
            new_final_url_suffix: resolved.finalUrlSuffix,
            success: true,
            skipped: true,
          })
          continue
        }

        const targetAuth = await resolveSitelinkTargetApiAuth({
          userId: params.userId,
          target,
          db,
          accountMetaById,
          prepareCache,
        })

        await updateSingleSitelinkAssetSuffix({
          target,
          finalUrlSuffix: resolved.finalUrlSuffix,
          userId: params.userId,
          refreshToken: targetAuth.refreshToken,
          authType: targetAuth.authType,
          serviceAccountId:
            targetAuth.authType === 'service_account' ? targetAuth.serviceAccountId : undefined,
          oauthLoginCustomerId: targetAuth.oauthLoginCustomerId,
          serviceAccountMccId: targetAuth.serviceAccountMccId,
          parentMccId: targetAuth.parentMccId,
          oauthCredentials: targetAuth.oauthCredentials,
          authContext: targetAuth.authContext,
        })

        await markUrlSwapSitelinkTargetSuccess(target.id, {
          finalUrl: resolved.finalUrl,
          finalUrlSuffix: resolved.finalUrlSuffix,
        })

        if (suffixChanged) {
          result.changed = true
        }
        result.successCount++
        result.updates.push({
          ...baseUpdate,
          new_final_url_suffix: resolved.finalUrlSuffix,
          success: true,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        await markUrlSwapSitelinkTargetFailure(target.id, message)
        result.failureCount++
        result.updates.push({
          ...baseUpdate,
          success: false,
          error_message: message,
        })
        console.warn(
          `[url-swap-sitelink] 更新失败: task=${params.taskId}, asset=${target.asset_id}, error=${message}`
        )
      }
    }
  } finally {
    clearGoogleAdsLinkedAccountPrepareCache(prepareCache)
  }

  console.log(
    `[url-swap-sitelink] 完成: task=${params.taskId}, success=${result.successCount}, failed=${result.failureCount}, skipped=${result.skippedCount}, changed=${result.changed}`
  )

  return result
}

export function mergeSitelinkPhaseIntoHistory(
  entry: SwapHistoryEntry,
  sitelinkPhase: UrlSwapSitelinkPhaseResult
): SwapHistoryEntry {
  if (!sitelinkPhase.enabled || sitelinkPhase.updates.length === 0) {
    return entry
  }
  return {
    ...entry,
    sitelink_updates: sitelinkPhase.updates,
    sitelink_success_count: sitelinkPhase.successCount,
    sitelink_failure_count: sitelinkPhase.failureCount,
  }
}
