import { prepareGoogleAdsAccountApiCall } from './google-ads-accounts-auth'
import { resolveGoogleAdsApiAuthForAccount } from './google-ads-auth-context'
import { runWithLoginCustomerFallbackForAccount } from './google-ads-login-customer'
import {
  removeGoogleAdsCampaign,
  updateGoogleAdsCampaignStatus,
  type OAuthApiCredentialsFields,
} from './google-ads-api'
import { getGoogleAdsAccountDeleteRemoteConfig } from './google-ads-account-delete-config'
import { runWithConcurrency, withTimeout } from './run-with-concurrency'

export interface GoogleAdsAccountRemoteRef {
  id: number
  customer_id: string | null
  parent_mcc_id: string | null
  service_account_id?: string | null
  is_active: boolean | number | null
  is_deleted: boolean | number | null
}

export interface CampaignRemoteRef {
  google_campaign_id: string
}

export type GoogleAdsCampaignRemoteActionOutcome =
  | 'REMOVED'
  | 'PAUSED'
  | 'PAUSED_FALLBACK'
  | 'FAILED'

export type GoogleAdsCampaignRemoteActionOutcomeEvent = {
  campaignId: string
  outcome: GoogleAdsCampaignRemoteActionOutcome
  reason?: string
}

export interface GoogleAdsCampaignRemoteActionFailure {
  campaignId: string
  reason: string
}

export interface GoogleAdsCampaignRemoteActionSummary {
  planned: number
  attempted: number
  paused: number
  removed: number
  pausedFallback: number
  failed: number
  action: 'REMOVE' | 'PAUSE' | 'NONE'
  executed: boolean
  skipReason?: 'NO_CAMPAIGNS' | 'ACCOUNT_INELIGIBLE' | 'CREDENTIALS_MISSING'
  failures: GoogleAdsCampaignRemoteActionFailure[]
  truncated: number
  maxCampaigns: number
  timedOut: boolean
  concurrency: number
}

export interface ExecuteGoogleAdsCampaignRemoteActionsParams {
  userId: number
  adsAccount: GoogleAdsAccountRemoteRef
  campaigns: CampaignRemoteRef[]
  shouldRemove: boolean
  logPrefix: string
  skipAccountEligibilityCheck?: boolean
  limitMeta?: {
    truncated: number
    maxCampaigns: number
  }
  remoteConfig?: ReturnType<typeof getGoogleAdsAccountDeleteRemoteConfig>
  /** 单项远端操作完成时回调（用于同步本地状态，如 Offer 删除） */
  onCampaignOutcome?: (
    event: GoogleAdsCampaignRemoteActionOutcomeEvent
  ) => void | Promise<void>
}

function resolveAccountEligibility(
  adsAccount: GoogleAdsAccountRemoteRef,
  skipAccountEligibilityCheck?: boolean
): boolean {
  const accountIsActive = adsAccount.is_active === true || adsAccount.is_active === 1
  const accountIsDeleted = adsAccount.is_deleted === true || adsAccount.is_deleted === 1
  if (skipAccountEligibilityCheck) {
    return Boolean(adsAccount.customer_id && !accountIsDeleted)
  }
  return Boolean(adsAccount.customer_id && accountIsActive && !accountIsDeleted)
}

function emptySummary(
  partial: Partial<GoogleAdsCampaignRemoteActionSummary>
): GoogleAdsCampaignRemoteActionSummary {
  return {
    planned: 0,
    attempted: 0,
    paused: 0,
    removed: 0,
    pausedFallback: 0,
    failed: 0,
    action: 'NONE',
    executed: false,
    failures: [],
    truncated: 0,
    maxCampaigns: 0,
    timedOut: false,
    concurrency: 1,
    ...partial,
  }
}

/**
 * 同步执行：在 Google Ads 远端暂停或删除 Campaign（有限并发 + 超时），返回逐项结果
 */
export async function executeGoogleAdsCampaignRemoteActions(
  params: ExecuteGoogleAdsCampaignRemoteActionsParams
): Promise<GoogleAdsCampaignRemoteActionSummary> {
  const {
    userId,
    adsAccount,
    campaigns,
    shouldRemove,
    logPrefix,
    skipAccountEligibilityCheck,
    onCampaignOutcome,
  } = params

  const emitOutcome = async (event: GoogleAdsCampaignRemoteActionOutcomeEvent) => {
    if (!onCampaignOutcome) return
    await onCampaignOutcome(event)
  }
  const remoteConfig = params.remoteConfig ?? getGoogleAdsAccountDeleteRemoteConfig()
  const action: 'REMOVE' | 'PAUSE' = shouldRemove ? 'REMOVE' : 'PAUSE'
  const planned = campaigns.length
  const truncated = params.limitMeta?.truncated ?? 0
  const maxCampaigns = params.limitMeta?.maxCampaigns ?? remoteConfig.maxCampaigns

  if (planned === 0) {
    return emptySummary({
      action: 'NONE',
      skipReason: 'NO_CAMPAIGNS',
      truncated,
      maxCampaigns,
      concurrency: remoteConfig.concurrency,
    })
  }

  if (!resolveAccountEligibility(adsAccount, skipAccountEligibilityCheck)) {
    return emptySummary({
      planned,
      action,
      skipReason: 'ACCOUNT_INELIGIBLE',
      truncated,
      maxCampaigns,
      concurrency: remoteConfig.concurrency,
    })
  }

  const summary = emptySummary({
    planned,
    action,
    executed: false,
    truncated,
    maxCampaigns,
    concurrency: remoteConfig.concurrency,
  })

  try {
    const authResolved = await resolveGoogleAdsApiAuthForAccount(
      userId,
      adsAccount.service_account_id
    )

    if (!authResolved.ok) {
      const reason =
        authResolved.reason === 'service_account_missing'
          ? '缺少服务账号配置，无法调用远端 API'
          : '缺少 Google Ads OAuth 凭证，无法调用远端 API'
      return {
        ...summary,
        executed: false,
        skipReason: 'CREDENTIALS_MISSING',
        failures: [{ campaignId: '*', reason }],
      }
    }

    const { ctx, apiAuth } = authResolved
    const auth = ctx.auth
    let refreshToken = apiAuth.refreshToken
    const serviceAccountId = apiAuth.serviceAccountId

    let oauthCredentials: OAuthApiCredentialsFields | undefined
    let oauthLoginCustomerId: string | undefined
    if (apiAuth.authType === 'oauth') {
      const prepared = await prepareGoogleAdsAccountApiCall({
        authContext: ctx,
        linkedServiceAccountId: adsAccount.service_account_id,
      })
      if (!prepared.ok) {
        return {
          ...summary,
          executed: false,
          skipReason: 'CREDENTIALS_MISSING',
          failures: [{ campaignId: '*', reason: prepared.message }],
        }
      }
      refreshToken = prepared.refreshToken
      oauthCredentials = prepared.oauthCredentials
      oauthLoginCustomerId =
        prepared.oauthLoginCustomerId ?? prepared.apiAuth.oauthLoginCustomerId
    }

    summary.executed = true

    const processedCampaignIds = new Set<string>()
    const outcomeEmittedIds = new Set<string>()
    const deadline = Date.now() + remoteConfig.totalTimeoutMs

    const recordOutcome = async (event: GoogleAdsCampaignRemoteActionOutcomeEvent) => {
      outcomeEmittedIds.add(event.campaignId)
      await emitOutcome(event)
    }

    const processOneCampaign = async (campaign: CampaignRemoteRef) => {
      const googleCampaignId = String(campaign.google_campaign_id)
      if (processedCampaignIds.has(googleCampaignId)) {
        return
      }

      if (Date.now() > deadline) {
        const reason = `整体操作超时（${remoteConfig.totalTimeoutMs}ms），未执行`
        summary.failed++
        summary.failures.push({
          campaignId: googleCampaignId,
          reason,
        })
        processedCampaignIds.add(googleCampaignId)
        await recordOutcome({ campaignId: googleCampaignId, outcome: 'FAILED', reason })
        return
      }

      processedCampaignIds.add(googleCampaignId)
      summary.attempted++

      const runAction = async (loginCustomerId: string | undefined) => {
        if (shouldRemove) {
          await removeGoogleAdsCampaign({
            customerId: adsAccount.customer_id!,
            refreshToken,
            campaignId: googleCampaignId,
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: auth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
          })
          summary.removed++
          await recordOutcome({ campaignId: googleCampaignId, outcome: 'REMOVED' })
        } else {
          await updateGoogleAdsCampaignStatus({
            customerId: adsAccount.customer_id!,
            refreshToken,
            campaignId: googleCampaignId,
            status: 'PAUSED',
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: auth.authType,
            serviceAccountId,
            credentials: oauthCredentials,
          })
          summary.paused++
          await recordOutcome({ campaignId: googleCampaignId, outcome: 'PAUSED' })
        }
      }

      const runWithLoginFallback = (action: (loginCustomerId: string | undefined) => Promise<void>) =>
        runWithLoginCustomerFallbackForAccount({
          adsAccount: {
            customer_id: adsAccount.customer_id!,
            parent_mcc_id: adsAccount.parent_mcc_id,
            id: adsAccount.id,
          },
          refreshToken,
          authType: auth.authType,
          serviceAccountId,
          serviceAccountMccId: apiAuth.serviceAccountMccId,
          oauthLoginCustomerId,
          actionName: shouldRemove
            ? `删除 Campaign ${googleCampaignId}`
            : `暂停 Campaign ${googleCampaignId}`,
          callback: action,
        })

      try {
        await withTimeout(
          runWithLoginFallback(runAction),
          remoteConfig.perCampaignTimeoutMs,
          `Campaign ${googleCampaignId}`
        )
      } catch (err: any) {
        if (shouldRemove) {
          try {
            await withTimeout(
              runWithLoginFallback((loginCustomerId) =>
                updateGoogleAdsCampaignStatus({
                  customerId: adsAccount.customer_id!,
                  refreshToken,
                  campaignId: googleCampaignId,
                  status: 'PAUSED',
                  accountId: adsAccount.id,
                  userId,
                  loginCustomerId,
                  authType: auth.authType,
                  serviceAccountId,
                  credentials: oauthCredentials,
                })
              ),
              remoteConfig.perCampaignTimeoutMs,
              `Campaign ${googleCampaignId} pause fallback`
            )
            summary.pausedFallback++
            await recordOutcome({ campaignId: googleCampaignId, outcome: 'PAUSED_FALLBACK' })
          } catch (pauseErr: any) {
            const reason = String(pauseErr?.message || err?.message || 'UNKNOWN_ERROR')
            summary.failed++
            summary.failures.push({
              campaignId: googleCampaignId,
              reason,
            })
            await recordOutcome({ campaignId: googleCampaignId, outcome: 'FAILED', reason })
          }
        } else {
          const reason = String(err?.message || 'UNKNOWN_ERROR')
          summary.failed++
          summary.failures.push({
            campaignId: googleCampaignId,
            reason,
          })
          await recordOutcome({ campaignId: googleCampaignId, outcome: 'FAILED', reason })
        }
      }
    }

    try {
      await withTimeout(
        runWithConcurrency(campaigns, remoteConfig.concurrency, async (campaign) => {
          await processOneCampaign(campaign)
        }),
        remoteConfig.totalTimeoutMs,
        'Google Ads 账号删除远端批处理'
      )
    } catch (err: any) {
      summary.timedOut = true
      const batchTimeoutReason = String(err?.message || '整体操作超时')
      for (const campaign of campaigns) {
        const googleCampaignId = String(campaign.google_campaign_id)
        if (outcomeEmittedIds.has(googleCampaignId)) {
          continue
        }
        const wasInFlight = processedCampaignIds.has(googleCampaignId)
        if (!wasInFlight) {
          processedCampaignIds.add(googleCampaignId)
        }
        const reason = wasInFlight
          ? `${batchTimeoutReason}（批处理中断，远端结果不确定）`
          : batchTimeoutReason
        summary.failed++
        summary.failures.push({
          campaignId: googleCampaignId,
          reason,
        })
        await recordOutcome({ campaignId: googleCampaignId, outcome: 'FAILED', reason })
      }
    }

    for (const campaign of campaigns) {
      const googleCampaignId = String(campaign.google_campaign_id)
      if (outcomeEmittedIds.has(googleCampaignId)) {
        continue
      }
      if (!processedCampaignIds.has(googleCampaignId)) {
        const reason = '未执行（整体超时或调度中断）'
        summary.failed++
        summary.failures.push({
          campaignId: googleCampaignId,
          reason,
        })
        processedCampaignIds.add(googleCampaignId)
        await recordOutcome({ campaignId: googleCampaignId, outcome: 'FAILED', reason })
      }
    }
  } catch (err: any) {
    console.error(`[${logPrefix}] Google Ads remote action failed:`, err?.message || err)
    const handledCount = summary.removed + summary.paused + summary.pausedFallback
    const unhandledCount = Math.max(0, summary.planned - handledCount)
    summary.failed = Math.max(summary.failed, unhandledCount)
    if (!summary.failures.some((item) => item.campaignId === '*')) {
      summary.failures.push({
        campaignId: '*',
        reason: String(err?.message || 'UNKNOWN_ERROR'),
      })
    }
  } finally {
    console.log(`[${logPrefix}] Google Ads remote summary:`, summary)
  }

  return summary
}

export interface QueueGoogleAdsCampaignRemoteActionsResult {
  queued: boolean
  planned: number
  action: 'REMOVE' | 'PAUSE' | 'NONE'
}

/**
 * 异步 best-effort：不阻塞调用方（用于 Offer 解绑等）
 */
export function queueGoogleAdsCampaignRemoteActions(
  params: ExecuteGoogleAdsCampaignRemoteActionsParams
): QueueGoogleAdsCampaignRemoteActionsResult {
  const action: 'REMOVE' | 'PAUSE' = params.shouldRemove ? 'REMOVE' : 'PAUSE'
  const planned = params.campaigns.length

  if (
    planned === 0 ||
    !resolveAccountEligibility(params.adsAccount, params.skipAccountEligibilityCheck)
  ) {
    return { queued: false, planned, action: planned > 0 ? action : 'NONE' }
  }

  void executeGoogleAdsCampaignRemoteActions(params)

  return { queued: true, planned, action }
}
