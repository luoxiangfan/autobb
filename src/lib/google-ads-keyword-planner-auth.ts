import { getDatabase } from './db'
import type { KeywordIdeasPreparedOAuth } from './google-ads-keyword-planner'
import { getKeywordSearchVolumes } from './keyword-planner'
import {
  prepareGoogleAdsApiCallForLinkedAccount,
  preparedAuthContextField,
  syncUserCredentialsFromPrepared,
} from './google-ads-api-prepare'
import type {
  KeywordPlannerPreparedSession,
  KeywordPlannerVolumeAuth,
  KeywordPlannerVolumeAuthContextParams,
  KeywordPlannerVolumeAuthLoadResult,
  KeywordPoolExpandLoadResult,
  PreparedGoogleAdsAccountApiCall,
  ResolveKeywordPlannerLinkedSaParams,
} from './google-ads-accounts-auth-types'
import type { GoogleAdsAuthContext } from './google-ads-auth-context'

export function buildKeywordPlannerSessionFromPrepared(
  prepared: { authContext: GoogleAdsAuthContext } & PreparedGoogleAdsAccountApiCall
): KeywordPlannerPreparedSession {
  const volumeAuth = keywordPlannerVolumeAuthFromPrepared(prepared.authContext, prepared)

  let preparedOAuth: KeywordIdeasPreparedOAuth | undefined
  if (prepared.apiAuth.authType === 'oauth' && prepared.oauthCredentials) {
    preparedOAuth = {
      refreshToken: prepared.refreshToken,
      credentials: prepared.oauthCredentials,
      oauthLoginCustomerId:
        prepared.oauthLoginCustomerId ?? prepared.apiAuth.oauthLoginCustomerId,
      ...preparedAuthContextField(prepared),
    }
  }

  return { preparedOAuth, volumeAuth }
}

export function keywordPlannerVolumeAuthFromPrepared(
  authContext: GoogleAdsAuthContext,
  prepared: PreparedGoogleAdsAccountApiCall
): KeywordPlannerVolumeAuth {
  return {
    authType: prepared.apiAuth.authType,
    serviceAccountId: prepared.apiAuth.serviceAccountId,
    plannerAuth: {
      existingContext: authContext,
      healedOAuth: prepared.oauthCredentials
        ? {
            credentials: prepared.oauthCredentials,
            loginCustomerId: prepared.oauthLoginCustomerId,
            refreshToken: prepared.refreshToken,
          }
        : undefined,
    },
  }
}

export async function resolveLinkedServiceAccountIdForGoogleAdsAccount(
  userId: number,
  googleAdsAccountId: number
): Promise<string | null> {
  const db = await getDatabase()
  const row = await db.queryOne<{ service_account_id: string | null }>(
    `SELECT service_account_id FROM google_ads_accounts WHERE id = ? AND user_id = ? LIMIT 1`,
    [googleAdsAccountId, userId]
  )
  const linked = row?.service_account_id?.trim()
  return linked || null
}

export async function resolveLinkedServiceAccountIdForOffer(
  userId: number,
  offerId?: number
): Promise<string | null> {
  const db = await getDatabase()

  if (offerId) {
    const fromCampaign = await db.queryOne<{ service_account_id: string | null }>(
      `SELECT ga.service_account_id
       FROM google_ads_accounts ga
       INNER JOIN campaigns c ON c.google_ads_account_id = ga.id AND c.user_id = ?
       WHERE c.offer_id = ?
         AND ga.service_account_id IS NOT NULL
         AND TRIM(ga.service_account_id) <> ''
       ORDER BY c.updated_at DESC
       LIMIT 1`,
      [userId, offerId]
    )
    const linkedFromCampaign = fromCampaign?.service_account_id?.trim()
    if (linkedFromCampaign) return linkedFromCampaign
  }

  const isActiveCondition =
    db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const isManagerCondition =
    db.type === 'postgres' ? 'is_manager_account = false' : 'is_manager_account = 0'

  const account = await db.queryOne<{ service_account_id: string | null }>(
    `SELECT service_account_id FROM google_ads_accounts
     WHERE user_id = ? AND ${isActiveCondition} AND status = 'ENABLED' AND ${isManagerCondition}
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  )

  const linked = account?.service_account_id?.trim()
  return linked || null
}

export async function loadKeywordPlannerVolumeAuthForOffer(
  userId: number,
  offerId?: number
): Promise<KeywordPlannerVolumeAuthLoadResult> {
  return loadKeywordPlannerVolumeAuthForContext({ userId, offerId })
}

export async function resolveLinkedServiceAccountIdForKeywordPlannerContext(
  params: KeywordPlannerVolumeAuthContextParams
): Promise<string | null> {
  if (params.linkedServiceAccountId !== undefined) {
    return params.linkedServiceAccountId
  }
  if (params.googleAdsAccountId) {
    return resolveLinkedServiceAccountIdForGoogleAdsAccount(
      params.userId,
      params.googleAdsAccountId
    )
  }
  return resolveLinkedServiceAccountIdForOffer(params.userId, params.offerId)
}

export async function loadKeywordPlannerVolumeAuthForContext(
  params: KeywordPlannerVolumeAuthContextParams
): Promise<KeywordPlannerVolumeAuthLoadResult> {
  const linkedSa = await resolveLinkedServiceAccountIdForKeywordPlannerContext(params)
  return loadKeywordPlannerVolumeAuth(params.userId, linkedSa)
}

export async function loadKeywordPlannerVolumeAuth(
  userId: number,
  linkedServiceAccountId?: string | null
): Promise<KeywordPlannerVolumeAuthLoadResult> {
  const prepared = await prepareGoogleAdsApiCallForLinkedAccount(
    userId,
    linkedServiceAccountId ?? null
  )
  if (!prepared.ok) {
    return { ok: false, message: prepared.message }
  }

  return {
    ok: true,
    volumeAuth: keywordPlannerVolumeAuthFromPrepared(prepared.authContext, prepared),
  }
}

export async function getKeywordSearchVolumesForPlannerContext(
  params: KeywordPlannerVolumeAuthContextParams & {
    keywords: string[]
    country: string
    language: string
    plannerSession?: KeywordPlannerPreparedSession
    onProgress?: (info: { message: string; current?: number; total?: number }) => Promise<void> | void
  }
): Promise<
  | { ok: true; volumes: Awaited<ReturnType<typeof getKeywordSearchVolumes>> }
  | { ok: false; message: string }
> {
  let volumeAuth = params.plannerSession?.volumeAuth
  if (!volumeAuth) {
    const loaded = await loadKeywordPlannerVolumeAuthForContext(params)
    if (!loaded.ok) {
      return { ok: false, message: loaded.message }
    }
    volumeAuth = loaded.volumeAuth
  }

  const volumes = await getKeywordSearchVolumes(
    params.keywords,
    params.country,
    params.language,
    params.userId,
    volumeAuth.authType,
    volumeAuth.serviceAccountId,
    params.onProgress,
    volumeAuth.plannerAuth
  )
  return { ok: true, volumes }
}

export async function resolveKeywordPlannerLinkedServiceAccountId(
  params: ResolveKeywordPlannerLinkedSaParams
): Promise<string | null> {
  if (params.linkedServiceAccountId !== undefined) {
    return params.linkedServiceAccountId
  }
  if (params.offerId) {
    return resolveLinkedServiceAccountIdForOffer(params.userId, params.offerId)
  }
  const legacy = params.serviceAccountId?.trim()
  return legacy || null
}

export async function queryGoogleAdsAccountForOfferExpand(
  userId: number,
  offerId: number
): Promise<{ id: number; customer_id: string } | undefined> {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
  const isManagerCondition =
    db.type === 'postgres' ? 'is_manager_account = false' : 'is_manager_account = 0'

  const fromCampaign = await db.queryOne<{ id: number; customer_id: string }>(
    `SELECT ga.id, ga.customer_id
     FROM google_ads_accounts ga
     INNER JOIN campaigns c ON c.google_ads_account_id = ga.id AND c.user_id = ?
     WHERE c.offer_id = ?
       AND ga.status = 'ENABLED'
       AND ${isActiveCondition}
       AND ${isManagerCondition}
     ORDER BY c.updated_at DESC
     LIMIT 1`,
    [userId, offerId]
  )
  if (fromCampaign?.customer_id) {
    return fromCampaign
  }

  return db.queryOne<{ id: number; customer_id: string }>(
    `SELECT id, customer_id FROM google_ads_accounts
     WHERE user_id = ? AND ${isActiveCondition} AND status = 'ENABLED' AND ${isManagerCondition}
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  )
}

export async function loadKeywordPoolExpandCredentialsForOffer(
  userId: number,
  offerId: number
): Promise<KeywordPoolExpandLoadResult> {
  const linkedSa = await resolveLinkedServiceAccountIdForOffer(userId, offerId)
  const prepared = await prepareGoogleAdsApiCallForLinkedAccount(userId, linkedSa)
  if (!prepared.ok) {
    return { ok: false }
  }

  const plannerSession = buildKeywordPlannerSessionFromPrepared(prepared)
  const authType = prepared.apiAuth.authType
  if (authType === 'service_account') {
    return {
      ok: true,
      creds: { authType: 'service_account', linkedServiceAccountId: linkedSa },
      plannerSession,
    }
  }

  const adsAccount = await queryGoogleAdsAccountForOfferExpand(userId, offerId)
  if (!adsAccount?.customer_id) {
    return {
      ok: true,
      creds: { authType: 'oauth', linkedServiceAccountId: linkedSa },
      plannerSession,
    }
  }

  const oauthCreds = syncUserCredentialsFromPrepared(prepared)
  return {
    ok: true,
    creds: {
      authType: 'oauth',
      linkedServiceAccountId: linkedSa,
      customerId: adsAccount.customer_id,
      refreshToken: prepared.refreshToken,
      accountId: adsAccount.id,
      clientId: oauthCreds?.client_id,
      clientSecret: oauthCreds?.client_secret,
      developerToken: oauthCreds?.developer_token,
    },
    plannerSession,
  }
}

export async function resolvePlannerExpandForOffer(
  userId: number,
  offerId: number,
  existing?: {
    plannerSession?: KeywordPlannerPreparedSession
    preparedExpand?: KeywordPoolExpandLoadResult
  }
): Promise<{
  plannerSession?: KeywordPlannerPreparedSession
  preparedExpand?: KeywordPoolExpandLoadResult
}> {
  if (existing?.preparedExpand !== undefined) {
    return {
      preparedExpand: existing.preparedExpand,
      plannerSession:
        existing.plannerSession ??
        (existing.preparedExpand.ok ? existing.preparedExpand.plannerSession : undefined),
    }
  }
  if (existing?.plannerSession !== undefined) {
    return {
      plannerSession: existing.plannerSession,
      preparedExpand: existing.preparedExpand,
    }
  }
  const expandLoad = await loadKeywordPoolExpandCredentialsForOffer(userId, offerId)
  return {
    preparedExpand: expandLoad,
    plannerSession: expandLoad.ok ? expandLoad.plannerSession : undefined,
  }
}
