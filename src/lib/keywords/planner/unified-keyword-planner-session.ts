/**
 * Keyword Planner session auth helpers.
 */
import { getKeywordSearchVolumes } from './keyword-planner'
import {
  buildKeywordPlannerSessionFromPrepared,
  prepareGoogleAdsApiCallForLinkedAccount,
  resolveKeywordPlannerLinkedServiceAccountId,
} from '@/lib/google-ads/accounts/auth/index'
import type { KeywordIdeasPreparedOAuth } from '@/lib/google-ads/keyword/planner'
import type {
  KeywordPlannerSessionAuth,
  KeywordPlannerSessionAuthResult,
  KeywordServiceParams,
} from './unified-keyword-types'

export async function prepareKeywordPlannerSessionAuth(
  userId: number | undefined,
  linkedServiceAccountId?: string | null
): Promise<KeywordPlannerSessionAuthResult> {
  if (!userId) {
    return { ok: false, message: 'userId is required' }
  }

  const prepared = await prepareGoogleAdsApiCallForLinkedAccount(
    userId,
    linkedServiceAccountId ?? null
  )
  if (!prepared.ok) {
    return { ok: false, message: prepared.message }
  }

  return { ok: true, session: buildKeywordPlannerSessionFromPrepared(prepared) }
}

async function getKeywordSearchVolumesWithSessionAuth(
  keywords: string[],
  country: string,
  language: string,
  userId: number | undefined,
  session: KeywordPlannerSessionAuth,
  onProgress?: (info: { message: string; current?: number; total?: number }) => Promise<void> | void
) {
  if (!userId || keywords.length === 0) return []

  const { volumeAuth } = session
  return getKeywordSearchVolumes(
    keywords,
    country,
    language,
    userId,
    volumeAuth.authType,
    volumeAuth.serviceAccountId,
    onProgress,
    volumeAuth.plannerAuth
  )
}

async function getKeywordSearchVolumesWithPreparedAuth(
  keywords: string[],
  country: string,
  language: string,
  userId: number | undefined,
  linkedServiceAccountId?: string | null,
  onProgress?: (info: { message: string; current?: number; total?: number }) => Promise<void> | void
) {
  const loaded = await prepareKeywordPlannerSessionAuth(userId, linkedServiceAccountId ?? null)
  if (!loaded.ok) {
    throw new Error(loaded.message)
  }
  return getKeywordSearchVolumesWithSessionAuth(
    keywords,
    country,
    language,
    userId,
    loaded.session,
    onProgress
  )
}

export function keywordPlannerIdeasAuthFromSession(
  plannerAuth: KeywordPlannerSessionAuthResult | null
): {
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
  preparedOAuth?: KeywordIdeasPreparedOAuth
} | null {
  if (!plannerAuth?.ok) return null
  return {
    authType: plannerAuth.session.volumeAuth.authType,
    serviceAccountId: plannerAuth.session.volumeAuth.serviceAccountId,
    preparedOAuth: plannerAuth.session.preparedOAuth,
  }
}

export function keywordPlannerIdeasBlockedReason(
  plannerAuth: KeywordPlannerSessionAuthResult | null
): string | null {
  if (!plannerAuth) return null
  if (!plannerAuth.ok) return plannerAuth.message

  const resolvedAuthType = plannerAuth.session.volumeAuth.authType
  if (resolvedAuthType === 'service_account') return null
  if (!plannerAuth.session.preparedOAuth) {
    return 'OAuth credentials unavailable for Keyword Planner'
  }
  return null
}

async function prepareKeywordPlannerSessionForServiceParams(
  userId: number | undefined,
  params: Pick<KeywordServiceParams, 'offerId' | 'linkedServiceAccountId' | 'plannerSession'>
): Promise<KeywordPlannerSessionAuthResult | null> {
  if (!userId) return null
  if (params.plannerSession) {
    return { ok: true, session: params.plannerSession }
  }
  const linkedSa = await resolveKeywordPlannerLinkedServiceAccountId({
    userId,
    offerId: params.offerId,
    linkedServiceAccountId: params.linkedServiceAccountId,
  })
  return prepareKeywordPlannerSessionAuth(userId, linkedSa)
}

export {
  prepareKeywordPlannerSessionForServiceParams,
  getKeywordSearchVolumesWithSessionAuth,
  getKeywordSearchVolumesWithPreparedAuth,
}
