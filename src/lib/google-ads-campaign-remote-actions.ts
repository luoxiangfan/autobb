import { getGoogleAdsAuthContext } from './google-ads-auth-context'
import { removeGoogleAdsCampaign, updateGoogleAdsCampaignStatus } from './google-ads-api'
import { getGoogleAdsAccountDeleteRemoteConfig } from './google-ads-account-delete-config'
import { runWithConcurrency, withTimeout } from './run-with-concurrency'

export interface GoogleAdsAccountRemoteRef {
  id: number
  customer_id: string | null
  parent_mcc_id: string | null
  is_active: boolean | number | null
  is_deleted: boolean | number | null
}

export interface CampaignRemoteRef {
  google_campaign_id: string
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
  const { userId, adsAccount, campaigns, shouldRemove, logPrefix, skipAccountEligibilityCheck } = params
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
    const ctx = await getGoogleAdsAuthContext(userId)
    const auth = ctx.auth
    const refreshToken = ctx.oauthCredentials?.refresh_token || ''

    if (auth.authType === 'oauth' && !refreshToken) {
      return {
        ...summary,
        executed: false,
        skipReason: 'CREDENTIALS_MISSING',
        failures: [
          {
            campaignId: '*',
            reason: '缺少 Google Ads OAuth 凭证，无法调用远端 API',
          },
        ],
      }
    }

    if (auth.authType === 'service_account' && !auth.serviceAccountId) {
      return {
        ...summary,
        executed: false,
        skipReason: 'CREDENTIALS_MISSING',
        failures: [
          {
            campaignId: '*',
            reason: '缺少服务账号配置，无法调用远端 API',
          },
        ],
      }
    }

    let loginCustomerId: string | undefined = ctx.oauthCredentials?.login_customer_id
      ? String(ctx.oauthCredentials.login_customer_id)
      : undefined
    if (!loginCustomerId && adsAccount.parent_mcc_id) {
      loginCustomerId = String(adsAccount.parent_mcc_id)
    }

    summary.executed = true

    const processedCampaignIds = new Set<string>()
    const deadline = Date.now() + remoteConfig.totalTimeoutMs

    const processOneCampaign = async (campaign: CampaignRemoteRef) => {
      const googleCampaignId = String(campaign.google_campaign_id)
      if (processedCampaignIds.has(googleCampaignId)) {
        return
      }

      if (Date.now() > deadline) {
        summary.failed++
        summary.failures.push({
          campaignId: googleCampaignId,
          reason: `整体操作超时（${remoteConfig.totalTimeoutMs}ms），未执行`,
        })
        processedCampaignIds.add(googleCampaignId)
        return
      }

      processedCampaignIds.add(googleCampaignId)
      summary.attempted++

      const runAction = async () => {
        if (shouldRemove) {
          await removeGoogleAdsCampaign({
            customerId: adsAccount.customer_id!,
            refreshToken,
            campaignId: googleCampaignId,
            accountId: adsAccount.id,
            userId,
            loginCustomerId,
            authType: auth.authType,
            serviceAccountId: auth.serviceAccountId,
          })
          summary.removed++
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
            serviceAccountId: auth.serviceAccountId,
          })
          summary.paused++
        }
      }

      try {
        await withTimeout(
          runAction(),
          remoteConfig.perCampaignTimeoutMs,
          `Campaign ${googleCampaignId}`
        )
      } catch (err: any) {
        if (shouldRemove) {
          try {
            await withTimeout(
              updateGoogleAdsCampaignStatus({
                customerId: adsAccount.customer_id!,
                refreshToken,
                campaignId: googleCampaignId,
                status: 'PAUSED',
                accountId: adsAccount.id,
                userId,
                loginCustomerId,
                authType: auth.authType,
                serviceAccountId: auth.serviceAccountId,
              }),
              remoteConfig.perCampaignTimeoutMs,
              `Campaign ${googleCampaignId} pause fallback`
            )
            summary.pausedFallback++
          } catch (pauseErr: any) {
            summary.failed++
            summary.failures.push({
              campaignId: googleCampaignId,
              reason: String(pauseErr?.message || err?.message || 'UNKNOWN_ERROR'),
            })
          }
        } else {
          summary.failed++
          summary.failures.push({
            campaignId: googleCampaignId,
            reason: String(err?.message || 'UNKNOWN_ERROR'),
          })
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
      for (const campaign of campaigns) {
        const googleCampaignId = String(campaign.google_campaign_id)
        if (processedCampaignIds.has(googleCampaignId)) {
          continue
        }
        summary.failed++
        summary.failures.push({
          campaignId: googleCampaignId,
          reason: String(err?.message || '整体操作超时'),
        })
        processedCampaignIds.add(googleCampaignId)
      }
    }

    for (const campaign of campaigns) {
      const googleCampaignId = String(campaign.google_campaign_id)
      if (!processedCampaignIds.has(googleCampaignId)) {
        summary.failed++
        summary.failures.push({
          campaignId: googleCampaignId,
          reason: '未执行（整体超时或调度中断）',
        })
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
