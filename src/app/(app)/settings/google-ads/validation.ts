import type { GoogleAdsCredentialStatus } from './types'

const PLACEHOLDER = '············'

/** 已配置且非双栈时锁定为后端 authType；否则跟随用户 Tab 选择 */
export function resolveEffectiveGoogleAdsAuthMethod(
  credentialStatus: Pick<
    GoogleAdsCredentialStatus,
    'hasCredentials' | 'authType' | 'dualStack'
  > | null,
  selectedMethod: 'oauth' | 'service_account'
): 'oauth' | 'service_account' {
  if (credentialStatus?.dualStack) {
    return selectedMethod
  }
  if (
    credentialStatus?.hasCredentials &&
    (credentialStatus.authType === 'oauth' || credentialStatus.authType === 'service_account')
  ) {
    return credentialStatus.authType
  }
  return selectedMethod
}

export function isGoogleAdsAuthMethodLocked(
  credentialStatus: Pick<GoogleAdsCredentialStatus, 'hasCredentials' | 'dualStack'> | null
): boolean {
  return Boolean(credentialStatus?.hasCredentials) && !credentialStatus?.dualStack
}

type GoogleAdsAuthMethodTab = 'oauth' | 'service_account'

/**
 * 从凭证状态解析设置页 Tab（未配置 / 双栈 / 半成品）。
 * 双栈时不偏向服务账号，默认 OAuth 便于对照清理；全新用户默认 OAuth。
 */
export function resolveGoogleAdsAuthMethodFromCredentialStatus(
  status:
    | Pick<
        GoogleAdsCredentialStatus,
        'authType' | 'dualStack' | 'hasServiceAccount' | 'hasRefreshToken' | 'hasOAuthFields'
      >
    | null
    | undefined
): GoogleAdsAuthMethodTab | null {
  if (!status) {
    return null
  }

  if (status.authType === 'oauth' || status.authType === 'service_account') {
    return status.authType
  }

  if (status.dualStack) {
    return 'oauth'
  }

  const hasOAuth = Boolean(status.hasRefreshToken || status.hasOAuthFields)
  const hasServiceAccount = Boolean(status.hasServiceAccount)

  if (hasOAuth && !hasServiceAccount) {
    return 'oauth'
  }
  if (hasServiceAccount && !hasOAuth) {
    return 'service_account'
  }

  return 'oauth'
}

type GoogleAdsAuthMethodTabState = Pick<
  GoogleAdsCredentialStatus,
  'authType' | 'dualStack' | 'hasCredentials'
>

/**
 * 是否用 API 解析结果覆盖当前 Tab。
 * 双栈 / 未配置时刷新凭证状态不重置用户已选 Tab；状态跃迁（首次加载、锁定、authType/双栈/已配置变化）时同步。
 */
export function shouldApplyGoogleAdsAuthMethodFromCredentialStatus(
  previous: GoogleAdsAuthMethodTabState | null | undefined,
  next: GoogleAdsAuthMethodTabState
): boolean {
  if (!previous) {
    return true
  }

  if (isGoogleAdsAuthMethodLocked(next)) {
    return true
  }

  if (next.authType !== previous.authType) {
    return true
  }

  if (Boolean(next.dualStack) !== Boolean(previous.dualStack)) {
    return true
  }

  if (Boolean(next.hasCredentials) !== Boolean(previous.hasCredentials)) {
    return true
  }

  return false
}

/** 凭证状态刷新后应展示的 Tab（未跃迁时保留 currentAuthMethod）。 */
export function resolveAuthMethodAfterCredentialStatusRefresh(
  previous: GoogleAdsAuthMethodTabState | null | undefined,
  next: GoogleAdsAuthMethodTabState &
    Pick<GoogleAdsCredentialStatus, 'hasServiceAccount' | 'hasRefreshToken' | 'hasOAuthFields'>,
  currentAuthMethod: GoogleAdsAuthMethodTab
): GoogleAdsAuthMethodTab {
  const resolvedMethod = resolveGoogleAdsAuthMethodFromCredentialStatus(next)
  if (resolvedMethod && shouldApplyGoogleAdsAuthMethodFromCredentialStatus(previous, next)) {
    return resolvedMethod
  }
  return currentAuthMethod
}

/** 是否应拉取服务账号列表（与凭证 GET 语义对齐，供设置页与双栈清理复用）。 */
export function shouldFetchGoogleAdsServiceAccounts(
  status: Pick<GoogleAdsCredentialStatus, 'authType' | 'hasServiceAccount'> | null | undefined
): boolean {
  if (!status) {
    return false
  }
  if (status.authType === 'service_account') {
    return true
  }
  return Boolean(status.hasServiceAccount && status.authType !== 'oauth')
}

export function validateGoogleAdsOAuthForm(
  formData: Record<string, string> | undefined
): string | null {
  const loginCustomerId = formData?.login_customer_id
  const clientId = formData?.client_id
  const clientSecret = formData?.client_secret
  const developerToken = formData?.developer_token

  const isValidValue = (v: string | undefined) => v && v.trim() !== '' && v !== PLACEHOLDER

  if (!isValidValue(loginCustomerId)) {
    return 'Login Customer ID (MCC账户ID) 是必填项'
  }
  if (!isValidValue(clientId)) {
    return 'OAuth Client ID 是必填项'
  }
  if (!isValidValue(clientSecret)) {
    return 'OAuth Client Secret 是必填项'
  }
  if (!isValidValue(developerToken)) {
    return 'Developer Token 是必填项'
  }
  return null
}

export function normalizeGoogleAdsFormForCompare(
  record: Record<string, string> | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(record || {})) {
    normalized[key] = String(rawValue || '')
  }
  return normalized
}

export function hasGoogleAdsUnsavedChanges(
  formData: Record<string, string> | undefined,
  savedFormData: Record<string, string> | undefined
): boolean {
  return (
    JSON.stringify(normalizeGoogleAdsFormForCompare(formData)) !==
    JSON.stringify(normalizeGoogleAdsFormForCompare(savedFormData))
  )
}
