/**
 * Url-swap Campaign final_url_suffix 更新与历史记录辅助。
 */
import { logger } from '@/lib/common/server'
import { markUrlSwapTargetSuccess, markUrlSwapTargetFailure } from './url-swap-targets'
import { recordSwapHistory } from './url-swap-task-lifecycle'
import type { SwapHistoryEntry, UrlSwapTaskTarget } from './url-swap-types'
import {
  mergeSitelinkPhaseIntoHistory,
  runUrlSwapSitelinkSuffixPhase,
  emptyUrlSwapSitelinkPhaseResult,
} from './url-swap-sitelink-updater'
import { getDatabase } from '@/lib/db'
import {
  updateCampaignFinalUrlSuffix,
  type OAuthApiCredentialsFields,
} from '@/lib/google-ads/api/api'
import { formatGoogleAdsApiError } from '@/lib/google-ads/api/error'
import { runWithLoginCustomerFallbackForAccount } from '@/lib/google-ads/oauth/login-customer'
import {
  createGoogleAdsLinkedAccountPrepareCache,
  clearGoogleAdsLinkedAccountPrepareCache,
  prepareGoogleAdsApiCallForLinkedAccountCached,
  preparedAuthContextField,
  type GoogleAdsLinkedAccountPrepareCache,
} from '@/lib/google-ads/accounts/auth/index'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'
import { assertUserExecutionAllowed } from '@/lib/campaign/server'

export function isOAuthInvalidGrantError(message: string): boolean {
  return (
    message.includes('invalid_grant') ||
    message.includes('Token has been expired') ||
    message.includes('Token has been revoked') ||
    message.includes('Token has been expired or revoked')
  )
}

export function formatUrlSwapGoogleAdsError(error: unknown): string {
  const responseData = (error as any)?.response?.data
  const formatted = formatGoogleAdsApiError(responseData ?? error)
  if (formatted && formatted !== 'Google Ads API error') return formatted
  return formatGoogleAdsApiError(error)
}

interface GoogleAdsUpdateAuthContext {
  refreshToken: string
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
  oauthLoginCustomerId?: string
  serviceAccountMccId?: string
  authContext?: GoogleAdsAuthContext
}

type UrlSwapAccountMeta = {
  service_account_id: string | null
  parent_mcc_id: string | null
}

async function updateSingleTargetWithLoginCustomerFallback(params: {
  target: UrlSwapTaskTarget
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
    actionName: `url-swap 更新 Campaign ${params.target.google_campaign_id}`,
    callback: (loginCustomerId) =>
      updateCampaignFinalUrlSuffix({
        customerId: params.target.google_customer_id,
        refreshToken: params.authType === 'oauth' ? params.refreshToken : '',
        campaignId: params.target.google_campaign_id,
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

async function resolveUrlSwapTargetApiAuth(params: {
  userId: number
  target: UrlSwapTaskTarget
  db: Awaited<ReturnType<typeof getDatabase>>
  accountMetaById: Map<number, UrlSwapAccountMeta>
  prepareCache: GoogleAdsLinkedAccountPrepareCache
}): Promise<
  GoogleAdsUpdateAuthContext & {
    parentMccId: string | null
    oauthCredentials?: OAuthApiCredentialsFields
  }
> {
  const accountId = params.target.google_ads_account_id
  if (accountId && !params.accountMetaById.has(accountId)) {
    const row = await params.db.queryOne<UrlSwapAccountMeta>(
      'SELECT service_account_id, parent_mcc_id FROM google_ads_accounts WHERE id = ? AND user_id = ?',
      [accountId, params.userId]
    )
    params.accountMetaById.set(accountId, {
      service_account_id: row?.service_account_id ?? null,
      parent_mcc_id: row?.parent_mcc_id ?? null,
    })
  }

  if (!accountId) {
    throw new Error('url-swap 目标缺少 google_ads_account_id，无法解析 Google Ads 凭证')
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

export async function updateUrlSwapTargetsFinalUrlSuffix(params: {
  targets: UrlSwapTaskTarget[]
  finalUrlSuffix: string
  userId: number
  db: Awaited<ReturnType<typeof getDatabase>>
}): Promise<{ successCount: number; failureCount: number; failures: string[] }> {
  const failures: string[] = []
  let successCount = 0
  let failureCount = 0

  const accountMetaById = new Map<number, UrlSwapAccountMeta>()
  const prepareCache = createGoogleAdsLinkedAccountPrepareCache()

  try {
    for (const target of params.targets) {
      await assertUserExecutionAllowed(params.userId, {
        source: `url-swap:target-update:${target.google_campaign_id || 'unknown'}`,
      })

      const targetAuth = await resolveUrlSwapTargetApiAuth({
        userId: params.userId,
        target,
        db: params.db,
        accountMetaById,
        prepareCache,
      })

      try {
        await updateSingleTargetWithLoginCustomerFallback({
          target,
          finalUrlSuffix: params.finalUrlSuffix,
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

        if (target.id) {
          await markUrlSwapTargetSuccess(target.id)
        }
        successCount += 1
      } catch (error: unknown) {
        const message = formatUrlSwapGoogleAdsError(error)
        failures.push(message)
        failureCount += 1
        if (target.id) {
          await markUrlSwapTargetFailure(target.id, message)
        }
      }
    }
  } finally {
    clearGoogleAdsLinkedAccountPrepareCache(prepareCache)
  }

  return { successCount, failureCount, failures }
}

export async function recordUrlSwapHistoryWithSitelinkPhase(params: {
  taskId: string
  offerId: number
  userId: number
  targetCountry: string
  db: Awaited<ReturnType<typeof getDatabase>>
  entry: SwapHistoryEntry
  runSitelink: boolean
}) {
  const sitelinkPhase = params.runSitelink
    ? await runUrlSwapSitelinkSuffixPhase({
        taskId: params.taskId,
        offerId: params.offerId,
        userId: params.userId,
        targetCountry: params.targetCountry,
        db: params.db,
      })
    : emptyUrlSwapSitelinkPhaseResult()

  if (!params.runSitelink) {
    logger.debug(
      `[url-swap-sitelink] 跳过 Sitelink 更新: task=${params.taskId}（Campaign 换链未成功或未执行）`
    )
  }

  await recordSwapHistory(params.taskId, mergeSitelinkPhaseIntoHistory(params.entry, sitelinkPhase))
  return sitelinkPhase
}

export function parseUrlSwapStringArrayJson(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim())
  }
  if (typeof input !== 'string' || !input.trim()) return []
  try {
    const parsed = JSON.parse(input)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim())
  } catch {
    return []
  }
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}
