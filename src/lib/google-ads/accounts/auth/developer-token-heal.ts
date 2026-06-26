import { getDatabase } from '../../../db'
import { getGoogleAdsOAuthConfigValue } from '@/lib/google-ads/settings/settings-store'
import {
  resolveGoogleAdsAuthReadyFailure,
  type GoogleAdsAuthContext,
} from '@/lib/google-ads/auth/context'
import type {
  AccountsRouteCredentials,
  DeveloperTokenHealResult,
} from '@/lib/google-ads/accounts/auth/types'
import { googleAdsCredentialsLogger } from '@/lib/google-ads/common/logger'

export function looksLikeOAuthClientId(value: string): boolean {
  return value.includes('.apps.googleusercontent.com')
}

export function looksLikeOAuthClientSecret(value: string): boolean {
  return /^GOCSPX[-_]?/i.test(value.trim())
}

export function looksLikeOAuthAccessToken(value: string): boolean {
  return /^ya29\./i.test(value.trim())
}

export function developerTokenLooksInvalid(developerToken: string, clientSecret: string): boolean {
  return (
    !developerToken ||
    developerToken.trim() === clientSecret.trim() ||
    looksLikeOAuthClientId(developerToken) ||
    looksLikeOAuthClientSecret(developerToken) ||
    looksLikeOAuthAccessToken(developerToken)
  )
}

function settingDeveloperTokenLooksOk(
  settingDeveloperToken: string,
  clientSecret: string
): boolean {
  return (
    !!settingDeveloperToken &&
    settingDeveloperToken.trim() !== clientSecret.trim() &&
    !looksLikeOAuthClientId(settingDeveloperToken) &&
    !looksLikeOAuthClientSecret(settingDeveloperToken) &&
    !looksLikeOAuthAccessToken(settingDeveloperToken) &&
    settingDeveloperToken.length >= 20
  )
}

const DEVELOPER_TOKEN_INVALID_MESSAGE =
  '当前 Developer Token 看起来不是有效的 Google Ads Developer Token（常见原因：误填为 OAuth Client Secret/Client ID/Access Token）。请在设置页面填写 Google Ads API Center 提供的 Developer Token 后重试。'

/**
 * OAuth / 服务账号：从 settings 自愈 developer_token，并 best-effort 写回凭证表。
 */
export async function healAccountsRouteDeveloperToken(params: {
  credentials: AccountsRouteCredentials
  authType: 'oauth' | 'service_account'
  ownerUserId: number
  clientSecret: string
  serviceAccountId?: string | null
  serviceAccountConfig?: { developerToken?: string } | null
  /* * 必填：共享认证 / 双栈须以调用方 userId 视角解析 */
  authContext: GoogleAdsAuthContext
}): Promise<DeveloperTokenHealResult> {
  const authFailure = resolveGoogleAdsAuthReadyFailure(params.authContext)
  if (authFailure?.reason === 'dual_stack') {
    return { ok: false, code: 'DUAL_STACK_CONFLICT', message: authFailure.message }
  }

  const developerToken = String(params.credentials.developer_token || '')
  if (!developerTokenLooksInvalid(developerToken, params.clientSecret)) {
    return { ok: true }
  }

  const settingDeveloperToken = await getGoogleAdsOAuthConfigValue(
    params.ownerUserId,
    'developer_token'
  )

  if (
    !settingDeveloperTokenLooksOk(settingDeveloperToken, params.clientSecret) ||
    settingDeveloperToken.trim() === developerToken.trim()
  ) {
    return {
      ok: false,
      code: 'DEVELOPER_TOKEN_INVALID',
      message: DEVELOPER_TOKEN_INVALID_MESSAGE,
    }
  }

  googleAdsCredentialsLogger.warn('developer_token_auto_healed', {
    authType: params.authType,
  })
  params.credentials.developer_token = settingDeveloperToken
  if (params.serviceAccountConfig && 'developerToken' in params.serviceAccountConfig) {
    params.serviceAccountConfig.developerToken = settingDeveloperToken
  }

  const db = await getDatabase()

  if (params.authType === 'oauth') {
    await db
      .exec(
        `UPDATE google_ads_credentials SET developer_token = ? WHERE user_id = ? AND is_active = true`,
        [settingDeveloperToken, params.ownerUserId]
      )
      .catch(() => {})
  } else if (params.serviceAccountId) {
    await db
      .exec(
        `UPDATE google_ads_service_accounts SET developer_token = ?, updated_at = NOW() WHERE user_id = ? AND id = ? AND is_active = true`,
        [settingDeveloperToken, params.ownerUserId, params.serviceAccountId]
      )
      .catch(() => {})
  }

  return { ok: true }
}
