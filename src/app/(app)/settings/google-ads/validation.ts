import type { GoogleAdsCredentialStatus } from './types'

const PLACEHOLDER = '············'

/* * 已配置且非双栈时锁定为后端 authType；否则跟随用户 Tab 选择 */
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
  | 'authType'
  | 'dualStack'
  | 'hasCredentials'
  | 'hasServiceAccount'
  | 'hasRefreshToken'
  | 'hasOAuthFields'
>

function isUnconfiguredCredentialTabState(
  status: Pick<GoogleAdsCredentialStatus, 'hasCredentials' | 'dualStack'>
): boolean {
  return !status.hasCredentials && !status.dualStack
}

/**
 * 是否用 API 解析结果覆盖当前 Tab。
 * 双栈刷新不重置用户已选 Tab；未配置时 OAuth/SA 半成品出现则同步；锁定与 authType/双栈/已配置跃迁时同步。
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

  if (isUnconfiguredCredentialTabState(previous) && isUnconfiguredCredentialTabState(next)) {
    if (Boolean(next.hasServiceAccount) !== Boolean(previous.hasServiceAccount)) {
      return true
    }
    if (Boolean(next.hasOAuthFields) !== Boolean(previous.hasOAuthFields)) {
      return true
    }
    if (Boolean(next.hasRefreshToken) !== Boolean(previous.hasRefreshToken)) {
      return true
    }
  }

  return false
}

/* * 凭证状态刷新后应展示的 Tab（未跃迁时保留 currentAuthMethod）。 */
export function resolveAuthMethodAfterCredentialStatusRefresh(
  previous: GoogleAdsAuthMethodTabState | null | undefined,
  next: GoogleAdsAuthMethodTabState,
  currentAuthMethod: GoogleAdsAuthMethodTab
): GoogleAdsAuthMethodTab {
  const resolvedMethod = resolveGoogleAdsAuthMethodFromCredentialStatus(next)
  if (resolvedMethod && shouldApplyGoogleAdsAuthMethodFromCredentialStatus(previous, next)) {
    return resolvedMethod
  }
  return currentAuthMethod
}

/* * 是否应拉取服务账号列表（与凭证 GET 语义对齐，供设置页与双栈清理复用）。 */
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

type OAuthCredentialStatusForGate = Pick<
  GoogleAdsCredentialStatus,
  | 'authType'
  | 'dualStack'
  | 'hasCredentials'
  | 'hasOAuthFields'
  | 'clientId'
  | 'clientIdConfigured'
  | 'clientSecretConfigured'
  | 'developerTokenConfigured'
  | 'loginCustomerId'
>

function oauthClientIdConfigured(status: OAuthCredentialStatusForGate): boolean {
  return Boolean(String(status.clientId || '').trim() || status.clientIdConfigured)
}

function oauthSecretsConfigured(status: OAuthCredentialStatusForGate): boolean {
  return Boolean(status.clientSecretConfigured && status.developerTokenConfigured)
}

function isOAuthFormFieldValuePresent(value: string | undefined): boolean {
  return Boolean(value && value.trim() !== '' && value !== PLACEHOLDER)
}

function resolveOAuthRequiredFieldPresence(
  formData: Record<string, string> | undefined,
  status: OAuthCredentialStatusForGate | null | undefined
): {
  loginCustomerId: string
  hasClientId: boolean
  hasClientSecret: boolean
  hasDeveloperToken: boolean
} {
  const loginCustomerId = isOAuthFormFieldValuePresent(formData?.login_customer_id)
    ? formData!.login_customer_id.trim()
    : String(status?.loginCustomerId || '').trim()

  const hasClientId =
    isOAuthFormFieldValuePresent(formData?.client_id) ||
    oauthClientIdConfigured(status ?? { hasCredentials: false })

  const hasClientSecret =
    isOAuthFormFieldValuePresent(formData?.client_secret) || Boolean(status?.clientSecretConfigured)

  const hasDeveloperToken =
    isOAuthFormFieldValuePresent(formData?.developer_token) ||
    Boolean(status?.developerTokenConfigured)

  return { loginCustomerId, hasClientId, hasClientSecret, hasDeveloperToken }
}

export function validateGoogleAdsOAuthForm(
  formData: Record<string, string> | undefined
): string | null {
  return validateGoogleAdsOAuthFormForSave(formData, null)
}

/**
 * OAuth 保存：表单值与 credential status 合并校验。
 * 已保存的敏感字段在表单为空/占位时，用 GET /credentials 的 configured 标记补全。
 */
export function validateGoogleAdsOAuthFormForSave(
  formData: Record<string, string> | undefined,
  credentialStatus: OAuthCredentialStatusForGate | null | undefined
): string | null {
  if (credentialStatus?.dualStack) {
    return '请先删除双栈认证中的其中一种配置后再保存'
  }

  const fields = resolveOAuthRequiredFieldPresence(formData, credentialStatus)

  if (!fields.loginCustomerId) {
    return 'Login Customer ID (MCC账户ID) 是必填项'
  }
  if (!fields.hasClientId) {
    return 'OAuth Client ID 是必填项'
  }
  if (!fields.hasClientSecret) {
    return 'OAuth Client Secret 是必填项'
  }
  if (!fields.hasDeveloperToken) {
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

/* * OAuth 启动授权：以 GET /credentials 快照为准，不依赖表单 focus 后的 clientId 占位状态 */
export function resolveGoogleAdsOAuthStartGate(
  status: OAuthCredentialStatusForGate | null | undefined
): { ok: true } | { ok: false; message: string } {
  if (!status) {
    return { ok: false, message: '正在加载 Google Ads 认证状态，请稍后重试' }
  }
  if (status.dualStack) {
    return { ok: false, message: '请先删除双栈认证中的其中一种配置后再启动 OAuth 授权' }
  }
  if (status.authType === 'service_account' && status.hasCredentials) {
    return {
      ok: false,
      message: '当前已配置服务账号认证，请删除服务账号或切换到 OAuth 后再启动授权',
    }
  }
  if (!String(status.loginCustomerId || '').trim()) {
    return { ok: false, message: '请先在设置中填写并保存 Login Customer ID (MCC)' }
  }
  if (!oauthClientIdConfigured(status)) {
    return { ok: false, message: '请先在设置中填写并保存 OAuth Client ID' }
  }
  if (!oauthSecretsConfigured(status)) {
    return { ok: false, message: '请先在设置中填写并保存 Client Secret 与 Developer Token' }
  }
  return { ok: true }
}

/* * OAuth 验证凭证：credential status 已保存字段齐全，且表单无未保存 OAuth 修改 */
export function resolveGoogleAdsOAuthVerifyGate(
  status: OAuthCredentialStatusForGate | null | undefined,
  hasUnsavedOAuthChanges: boolean
): { ok: true } | { ok: false; message: string } {
  if (hasUnsavedOAuthChanges) {
    return { ok: false, message: '请先保存 Google Ads 配置后再验证凭证' }
  }
  const startGate = resolveGoogleAdsOAuthStartGate(status)
  if (!startGate.ok) {
    return startGate
  }
  return { ok: true }
}

export function validateGoogleAdsServiceAccountForm(form: {
  name: string
  mccCustomerId: string
  developerToken: string
  serviceAccountJson: string
}): string | null {
  if (!form.name.trim()) {
    return '配置名称是必填项'
  }

  const mcc = form.mccCustomerId.replace(/[\s-]/g, '')
  if (!/^\d{10}$/.test(mcc)) {
    return 'MCC Customer ID 必须是10位数字（格式：1234567890）'
  }

  if (!form.developerToken.trim()) {
    return 'Developer Token 是必填项'
  }

  const jsonRaw = form.serviceAccountJson.trim()
  if (!jsonRaw) {
    return '服务账号 JSON 是必填项'
  }

  try {
    const data = JSON.parse(jsonRaw) as { client_email?: string; private_key?: string }
    if (!data.client_email?.trim() || !data.private_key?.trim()) {
      return '服务账号 JSON 缺少 client_email 或 private_key 字段'
    }
  } catch {
    return '服务账号 JSON 格式无效，请粘贴完整的 JSON 密钥文件内容'
  }

  return null
}
