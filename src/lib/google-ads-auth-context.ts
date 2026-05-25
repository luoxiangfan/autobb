import {
  getGoogleAdsAuthAssignment,
  isGoogleAdsAuthShared,
  resolveGoogleAdsCredentialOwnerId,
  type GoogleAdsAuthAssignment,
} from './google-ads-auth-assignment'
import { getGoogleAdsCredentials, getUserAuthType } from './google-ads-oauth'
import { getServiceAccountConfig } from './google-ads-service-account'

export interface GoogleAdsAuthContext {
  userId: number
  ownerUserId: number
  assignment: GoogleAdsAuthAssignment | null
  isShared: boolean
  canModify: boolean
  auth: {
    authType: 'oauth' | 'service_account'
    serviceAccountId?: string
  }
  oauthCredentials: Awaited<ReturnType<typeof getGoogleAdsCredentials>>
  serviceAccountConfig: Awaited<ReturnType<typeof getServiceAccountConfig>>
}

/**
 * 一次性解析用户的 Google Ads 认证上下文（assignment + 凭证）。
 */
export async function getGoogleAdsAuthContext(userId: number): Promise<GoogleAdsAuthContext> {
  const { ownerUserId, assignment, isShared } = await resolveGoogleAdsCredentialOwnerId(userId)
  const auth = await getUserAuthType(userId)

  let oauthCredentials: Awaited<ReturnType<typeof getGoogleAdsCredentials>> = null
  let serviceAccountConfig: Awaited<ReturnType<typeof getServiceAccountConfig>> = null

  if (auth.authType === 'oauth') {
    oauthCredentials = await getGoogleAdsCredentials(userId)
  } else {
    serviceAccountConfig = await getServiceAccountConfig(userId, auth.serviceAccountId)
  }

  return {
    userId,
    ownerUserId,
    assignment,
    isShared,
    canModify: !isGoogleAdsAuthShared(assignment),
    auth,
    oauthCredentials,
    serviceAccountConfig,
  }
}

export async function getGoogleAdsAuthContextReadonly(
  userId: number
): Promise<Pick<GoogleAdsAuthContext, 'assignment' | 'isShared' | 'canModify' | 'auth'>> {
  const assignment = await getGoogleAdsAuthAssignment(userId)
  const auth = await getUserAuthType(userId)
  return {
    assignment,
    isShared: isGoogleAdsAuthShared(assignment),
    canModify: !isGoogleAdsAuthShared(assignment),
    auth,
  }
}
