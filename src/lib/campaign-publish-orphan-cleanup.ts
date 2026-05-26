import { getDatabase } from './db'
import { updateGoogleAdsCampaignStatus, type OAuthApiCredentialsFields } from './google-ads-api'
import {
  resolveHealedOAuthCredentialsFields,
} from './google-ads-accounts-auth'
import {
  getGoogleAdsAuthContext,
  hasConfiguredGoogleAdsAuthFromContext,
  resolveGoogleAdsApiAuthFromContext,
} from './google-ads-auth-context'
import {
  resolveLoginCustomerCandidates,
  isGoogleAdsAccountAccessError,
} from './google-ads-login-customer'

export type CampaignPublishRollbackContext = {
  customerId: string
  refreshToken: string
  accountId: number
  userId: number
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
  oauthCredentials?: OAuthApiCredentialsFields
  runWithLoginCustomerFallbackAndHeartbeat: <T>(
    stage: string,
    operation: (loginCustomerId: string | undefined) => Promise<T>
  ) => Promise<T>
}

export type HistoricalOrphanCampaignRow = {
  id: number
  googleCampaignId: string
  googleAdsAccountId: number | null
}

function normalizeGoogleCampaignId(
  googleCampaignId: string | null | undefined,
  campaignId: string | null | undefined
): string | null {
  const fromGoogle = String(googleCampaignId || '').trim()
  if (fromGoogle) return fromGoogle
  const fromCampaign = String(campaignId || '').trim()
  return fromCampaign || null
}

/**
 * 查找同一 Offer 上所有失败记录中带远端 ID 的 Campaign（含换绑前的旧 Ads 账号）。
 */
export async function findHistoricalOrphanCampaignsForOffer(params: {
  offerId: number
  userId: number
  excludeCampaignId?: number
}): Promise<HistoricalOrphanCampaignRow[]> {
  const { offerId, userId, excludeCampaignId } = params
  const db = await getDatabase()

  const rows = await db.query(
    `
    SELECT id, campaign_id, google_campaign_id, google_ads_account_id
    FROM campaigns
    WHERE offer_id = ?
      AND user_id = ?
      AND creation_status = 'failed'
      ${excludeCampaignId ? 'AND id != ?' : ''}
    `,
    excludeCampaignId ? [offerId, userId, excludeCampaignId] : [offerId, userId]
  ) as Array<{
    id: number
    campaign_id: string | null
    google_campaign_id: string | null
    google_ads_account_id: number | null
  }>

  const seen = new Set<string>()
  const result: HistoricalOrphanCampaignRow[] = []

  for (const row of rows) {
    const googleCampaignId = normalizeGoogleCampaignId(row.google_campaign_id, row.campaign_id)
    if (!googleCampaignId) continue

    const accountKey = row.google_ads_account_id ?? 'null'
    const dedupeKey = `${accountKey}:${googleCampaignId}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    result.push({
      id: row.id,
      googleCampaignId,
      googleAdsAccountId: row.google_ads_account_id ?? null,
    })
  }

  return result
}

/** @deprecated 使用 findHistoricalOrphanCampaignsForOffer（已支持跨 Ads 账号） */
export async function findHistoricalOrphanGoogleCampaignIds(params: {
  offerId: number
  userId: number
  googleAdsAccountId: number
  excludeCampaignId?: number
}): Promise<Array<{ id: number; googleCampaignId: string }>> {
  const rows = await findHistoricalOrphanCampaignsForOffer({
    offerId: params.offerId,
    userId: params.userId,
    excludeCampaignId: params.excludeCampaignId,
  })
  return rows
    .filter(
      (row) =>
        row.googleAdsAccountId === params.googleAdsAccountId
        || row.googleAdsAccountId === null
    )
    .map(({ id, googleCampaignId }) => ({ id, googleCampaignId }))
}

async function runWithLoginCustomerFallbackForAccount<T>(params: {
  userId: number
  adsAccount: { customer_id: string; parent_mcc_id?: string | null; id: number }
  refreshToken: string
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
  serviceAccountMccId?: string
  oauthLoginCustomerId?: string
  actionName: string
  callback: (loginCustomerId: string | undefined) => Promise<T>
}): Promise<T> {
  const loginCustomerIdCandidates = resolveLoginCustomerCandidates({
    authType: params.authType,
    accountParentMccId: params.adsAccount.parent_mcc_id,
    oauthLoginCustomerId: params.oauthLoginCustomerId,
    serviceAccountMccId: params.serviceAccountMccId,
    targetCustomerId: params.adsAccount.customer_id,
  })

  let preferredLoginCustomerId = loginCustomerIdCandidates[0]
  let lastError: unknown = null

  for (let i = 0; i < loginCustomerIdCandidates.length; i++) {
    const loginCustomerId = loginCustomerIdCandidates[i]
    try {
      const result = await params.callback(loginCustomerId)
      preferredLoginCustomerId = loginCustomerId
      if (i > 0) {
        console.log(
          `✅ ${params.actionName} 使用备用 login_customer_id=${loginCustomerId || 'null(omit)'} 成功`
        )
      }
      return result
    } catch (error) {
      lastError = error
      const hasNextCandidate = i < loginCustomerIdCandidates.length - 1
      if (hasNextCandidate && isGoogleAdsAccountAccessError(error)) {
        console.warn(
          `⚠️ ${params.actionName} login_customer_id=${loginCustomerId || 'null(omit)'} 失败，切换候选重试`
        )
        continue
      }
      throw error
    }
  }

  throw lastError || new Error(`${params.actionName} 失败`)
}

/**
 * 为指定 Ads 账号构建暂停远端 Campaign 所需的回滚上下文（用于换绑后清理旧账号孤儿）。
 */
export async function buildPublishRollbackContextForAdsAccount(
  userId: number,
  googleAdsAccountId: number
): Promise<CampaignPublishRollbackContext | null> {
  const db = await getDatabase()
  const adsAccount = await db.queryOne(
    `
    SELECT id, customer_id, parent_mcc_id, service_account_id
    FROM google_ads_accounts
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `,
    [googleAdsAccountId, userId]
  ) as {
    id: number
    customer_id: string
    parent_mcc_id?: string | null
    service_account_id?: string | null
  } | undefined

  if (!adsAccount?.customer_id) {
    return null
  }

  const authContext = await getGoogleAdsAuthContext(userId)
  if (!hasConfiguredGoogleAdsAuthFromContext(authContext)) {
    return null
  }

  const apiAuth = await resolveGoogleAdsApiAuthFromContext(
    authContext,
    adsAccount.service_account_id
  )

  let oauthCredentials: OAuthApiCredentialsFields | undefined
  if (apiAuth.authType === 'oauth') {
    const healed = await resolveHealedOAuthCredentialsFields({
      userId,
      authContext,
    })
    if (!healed.ok) {
      return null
    }
    oauthCredentials = healed.credentials
  }

  const runWithLoginCustomerFallbackAndHeartbeat = async <T>(
    actionName: string,
    callback: (loginCustomerId: string | undefined) => Promise<T>
  ): Promise<T> =>
    runWithLoginCustomerFallbackForAccount({
      userId,
      adsAccount,
      refreshToken: apiAuth.refreshToken,
      authType: apiAuth.authType,
      serviceAccountId: apiAuth.serviceAccountId,
      serviceAccountMccId: apiAuth.serviceAccountMccId,
      oauthLoginCustomerId: apiAuth.oauthLoginCustomerId,
      actionName,
      callback,
    })

  return {
    customerId: adsAccount.customer_id,
    refreshToken: apiAuth.refreshToken,
    accountId: adsAccount.id,
    userId,
    authType: apiAuth.authType,
    serviceAccountId: apiAuth.serviceAccountId,
    oauthCredentials,
    runWithLoginCustomerFallbackAndHeartbeat,
  }
}

/** 发布中途失败时暂停本次刚创建的远端 Campaign。 */
export async function pauseOrphanGoogleAdsCampaignAfterPublishFailure(
  ctx: CampaignPublishRollbackContext,
  googleCampaignId: string
): Promise<void> {
  try {
    await ctx.runWithLoginCustomerFallbackAndHeartbeat(
      '发布失败暂停远端Campaign',
      (loginCustomerId) =>
        updateGoogleAdsCampaignStatus({
          customerId: ctx.customerId,
          refreshToken: ctx.refreshToken,
          campaignId: googleCampaignId,
          status: 'PAUSED',
          accountId: ctx.accountId,
          userId: ctx.userId,
          loginCustomerId,
          authType: ctx.authType,
          serviceAccountId: ctx.serviceAccountId,
          credentials: ctx.oauthCredentials,
        })
    )
    console.log(`⏸️ 发布失败已暂停远端孤儿 Campaign ${googleCampaignId}`)
  } catch (pauseError: any) {
    console.warn(
      `⚠️ 发布失败后暂停远端 Campaign 失败（googleCampaignId=${googleCampaignId}）: ${pauseError?.message || pauseError}`
    )
  }
}

async function resolveRollbackContextForOrphan(params: {
  currentCtx: CampaignPublishRollbackContext
  userId: number
  currentGoogleAdsAccountId: number
  orphanAccountId: number | null
  ctxByAccount: Map<number, CampaignPublishRollbackContext>
}): Promise<CampaignPublishRollbackContext | null> {
  if (params.orphanAccountId === null) {
    return null
  }

  const resolvedAccountId = params.orphanAccountId

  if (resolvedAccountId === params.currentGoogleAdsAccountId) {
    return params.currentCtx
  }

  const cached = params.ctxByAccount.get(resolvedAccountId)
  if (cached) {
    return cached
  }

  const built = await buildPublishRollbackContextForAdsAccount(params.userId, resolvedAccountId)
  if (built) {
    params.ctxByAccount.set(resolvedAccountId, built)
  }
  return built
}

/**
 * 发布前暂停同一 Offer 上历史失败残留的远端 Campaign（含换绑前的旧 Ads 账号）。
 */
export async function pauseHistoricalOrphanGoogleCampaignsForOffer(params: {
  ctx: CampaignPublishRollbackContext
  offerId: number
  userId: number
  googleAdsAccountId: number
  excludeCampaignId: number
}): Promise<{ attempted: number; paused: number; skipped: number; failed: number }> {
  const orphans = await findHistoricalOrphanCampaignsForOffer({
    offerId: params.offerId,
    userId: params.userId,
    excludeCampaignId: params.excludeCampaignId,
  })

  if (orphans.length === 0) {
    return { attempted: 0, paused: 0, skipped: 0, failed: 0 }
  }

  console.log(
    `[CampaignPublish] 发现 ${orphans.length} 个历史失败残留的远端 Campaign，开始暂停（offer=${params.offerId}，含跨账号）`
  )

  const ctxByAccount = new Map<number, CampaignPublishRollbackContext>()
  let paused = 0
  let skipped = 0
  let failed = 0

  for (const orphan of orphans) {
    const orphanAccountId = orphan.googleAdsAccountId

    if (orphanAccountId === null) {
      skipped++
      console.warn(
        `⚠️ 跳过历史孤儿 Campaign ${orphan.googleCampaignId}：缺少 google_ads_account_id（localId=${orphan.id}），请人工在 Google Ads 处理`
      )
      continue
    }

    const ctx = await resolveRollbackContextForOrphan({
      currentCtx: params.ctx,
      userId: params.userId,
      currentGoogleAdsAccountId: params.googleAdsAccountId,
      orphanAccountId,
      ctxByAccount,
    })

    if (!ctx) {
      skipped++
      console.warn(
        `⚠️ 跳过历史孤儿 Campaign ${orphan.googleCampaignId}：无法解析 Ads 账号上下文（localId=${orphan.id}, accountId=${orphanAccountId ?? 'null'}）`
      )
      continue
    }

    try {
      await ctx.runWithLoginCustomerFallbackAndHeartbeat(
        `暂停历史孤儿Campaign ${orphan.googleCampaignId}`,
        (loginCustomerId) =>
          updateGoogleAdsCampaignStatus({
            customerId: ctx.customerId,
            refreshToken: ctx.refreshToken,
            campaignId: orphan.googleCampaignId,
            status: 'PAUSED',
            accountId: ctx.accountId,
            userId: ctx.userId,
            loginCustomerId,
            authType: ctx.authType,
            serviceAccountId: ctx.serviceAccountId,
            credentials: ctx.oauthCredentials,
          })
      )
      paused++
      const accountNote =
        orphanAccountId && orphanAccountId !== params.googleAdsAccountId
          ? `，旧账号=${orphanAccountId}`
          : ''
      console.log(
        `⏸️ 已暂停历史孤儿 Campaign ${orphan.googleCampaignId}（localId=${orphan.id}${accountNote}）`
      )
    } catch (error: any) {
      failed++
      console.warn(
        `⚠️ 暂停历史孤儿 Campaign ${orphan.googleCampaignId} 失败: ${error?.message || error}`
      )
    }
  }

  if (failed > 0 || skipped > 0) {
    console.warn(
      `[CampaignPublish] 历史孤儿暂停汇总（offer=${params.offerId}）: attempted=${orphans.length}, paused=${paused}, skipped=${skipped}, failed=${failed}`
    )
  }

  return { attempted: orphans.length, paused, skipped, failed }
}
