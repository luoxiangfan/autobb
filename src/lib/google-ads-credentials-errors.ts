/**
 * Google Ads 凭证 / 账号列表 API 的前端错误文案与分类（共享于设置、Google Ads 页、Launch Step2）。
 */

export function formatErrorMessage(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  const maybeMessage = (value as { message?: string })?.message
  if (typeof maybeMessage === 'string') return maybeMessage
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function formatNullableErrorMessage(value: unknown): string | null {
  const msg = formatErrorMessage(value).trim()
  return msg ? msg : null
}

export async function safeReadJson(response: Response): Promise<unknown | null> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function buildGoogleAdsApiErrorMessage(
  response: Response,
  body: unknown | null,
  fallbackMessage?: string
): string {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  const msgFromBody =
    formatNullableErrorMessage(record?.message) || formatNullableErrorMessage(record?.error)

  if (msgFromBody) return msgFromBody

  if (response.status === 401) return '未登录或登录已过期，请刷新页面或重新登录'
  if (response.status === 403) return '权限不足'
  if (response.status === 409 && record?.code === 'AUTH_TYPE_MISMATCH') {
    return '认证方式与当前配置不一致，请前往设置页确认当前使用的认证类型'
  }

  return fallbackMessage || `请求失败 (HTTP ${response.status})`
}

export type AccountsListFetchFailure = {
  message: string
  needsReauth: boolean
}

export function parseAccountsListFetchFailure(
  response: Response,
  body: unknown | null,
  options?: { fallbackMessage?: string }
): AccountsListFetchFailure {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null

  if (record?.needsReauth || record?.code === 'OAUTH_TOKEN_EXPIRED') {
    return { message: 'OAuth授权已过期，请前往设置页重新授权', needsReauth: true }
  }

  if (record?.code === 'AUTH_TYPE_MISMATCH') {
    return {
      message:
        formatNullableErrorMessage(record.message) ||
        '认证方式与当前配置不一致，请前往设置页确认当前使用的认证类型。',
      needsReauth: false,
    }
  }

  return {
    message: buildGoogleAdsApiErrorMessage(
      response,
      body,
      options?.fallbackMessage || '获取账号列表失败'
    ),
    needsReauth: false,
  }
}

/** @throws Error — 可选附带 `needsReauth` 供调用方展示重授权 UI */
export function throwAccountsListFetchError(
  response: Response,
  body: unknown | null,
  options?: { fallbackMessage?: string }
): never {
  const { message, needsReauth } = parseAccountsListFetchFailure(response, body, options)
  const error = new Error(message) as Error & { needsReauth?: boolean }
  if (needsReauth) error.needsReauth = true
  throw error
}

/** 异步轮询时每隔 N 次刷新一次凭证状态，避免 auth_type 长期过期 */
export const GOOGLE_ADS_CREDENTIALS_POLL_REFRESH_EVERY = 5

export type ParsedGoogleAdsCredentialsStatus = {
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
  hasCredentials: boolean
  authConfigWarning: string | null
}

/** 解析 GET /api/google-ads/credentials 的 JSON（需已校验 response.ok） */
export function parseCredentialsStatusResponse(data: unknown): ParsedGoogleAdsCredentialsStatus {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  const payload =
    record?.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : null

  if (!record?.success || !payload) {
    return {
      authType: 'oauth',
      hasCredentials: false,
      authConfigWarning: null,
    }
  }

  const hasRefreshToken = Boolean(payload.hasRefreshToken)
  const hasServiceAccount = Boolean(payload.hasServiceAccount)
  const authType: 'oauth' | 'service_account' =
    payload.authType === 'service_account'
      ? 'service_account'
      : payload.authType === 'oauth'
        ? 'oauth'
        : hasRefreshToken
          ? 'oauth'
          : hasServiceAccount
            ? 'service_account'
            : 'oauth'

  return {
    authType,
    serviceAccountId: payload.serviceAccountId ? String(payload.serviceAccountId) : undefined,
    hasCredentials: Boolean(payload.hasCredentials),
    authConfigWarning: formatNullableErrorMessage(payload.authConfigWarning),
  }
}

export function credentialsStatusErrorMessage(data: unknown, fallback = '获取凭证状态失败'): string {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  return (
    formatNullableErrorMessage(record?.message) ||
    formatNullableErrorMessage(record?.error) ||
    fallback
  )
}

/** 拉取并解析 GET /api/google-ads/credentials（客户端） */
export async function fetchGoogleAdsCredentialsStatus(): Promise<ParsedGoogleAdsCredentialsStatus> {
  const credResponse = await fetch('/api/google-ads/credentials', {
    credentials: 'include',
  })
  if (!credResponse.ok) {
    const errorData = await safeReadJson(credResponse)
    throw new Error(buildGoogleAdsApiErrorMessage(credResponse, errorData, '获取凭证状态失败'))
  }
  const credData = await credResponse.json()
  if (!credData?.success) {
    throw new Error(credentialsStatusErrorMessage(credData))
  }
  return parseCredentialsStatusResponse(credData)
}

export type AccountsRequestAuth = Pick<ParsedGoogleAdsCredentialsStatus, 'authType' | 'serviceAccountId'>

export const GOOGLE_ADS_MISSING_SERVICE_ACCOUNT_MESSAGE =
  '未找到服务账号配置，请前往设置页面配置'

/** 合并凭证快照与服务账号 fallback，供 accounts 列表请求使用 */
export function buildAuthForAccountsRequest(
  auth: ParsedGoogleAdsCredentialsStatus,
  fallbackServiceAccountId?: string | null
): AccountsRequestAuth {
  if (auth.authType !== 'service_account') {
    return { authType: auth.authType, serviceAccountId: auth.serviceAccountId }
  }
  return {
    authType: 'service_account',
    serviceAccountId: auth.serviceAccountId || fallbackServiceAccountId || undefined,
  }
}

export function assertAccountsRequestAuth(authForRequest: AccountsRequestAuth): void {
  if (authForRequest.authType === 'service_account' && !authForRequest.serviceAccountId) {
    throw new Error(GOOGLE_ADS_MISSING_SERVICE_ACCOUNT_MESSAGE)
  }
}

export function appendAccountsAuthToSearchParams(
  params: URLSearchParams,
  auth: AccountsRequestAuth
): void {
  params.set('auth_type', auth.authType)
  if (auth.authType === 'service_account' && auth.serviceAccountId) {
    params.set('service_account_id', auth.serviceAccountId)
  }
}
