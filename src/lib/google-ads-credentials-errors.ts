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
  if (response.status === 409 && record?.code === 'DUAL_STACK_CONFLICT') {
    return (
      formatNullableErrorMessage(record.authConfigWarning) ||
      formatNullableErrorMessage(record.message) ||
      formatNullableErrorMessage(record.error) ||
      '检测到 OAuth 与服务账号同时存在，请先在设置页删除其中一种配置后再使用。'
    )
  }

  return fallbackMessage || `请求失败 (HTTP ${response.status})`
}

function parseAuthConfigWarningFromResponseBody(body: unknown): string | null {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  if (!record) return null
  const topLevel = formatNullableErrorMessage(record.authConfigWarning)
  if (topLevel) return topLevel
  const nested =
    record.data && typeof record.data === 'object'
      ? formatNullableErrorMessage((record.data as Record<string, unknown>).authConfigWarning)
      : null
  return nested
}

export type AccountsListFetchFailure = {
  message: string
  needsReauth: boolean
  authConfigWarning: string | null
}

export function parseAccountsListFetchFailure(
  response: Response,
  body: unknown | null,
  options?: { fallbackMessage?: string }
): AccountsListFetchFailure {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null

  if (record?.needsReauth || record?.code === 'OAUTH_TOKEN_EXPIRED') {
    return {
      message: 'OAuth授权已过期，请前往设置页重新授权',
      needsReauth: true,
      authConfigWarning: null,
    }
  }

  if (record?.code === 'AUTH_TYPE_MISMATCH') {
    return {
      message:
        formatNullableErrorMessage(record.message) ||
        '认证方式与当前配置不一致，请前往设置页确认当前使用的认证类型。',
      needsReauth: false,
      authConfigWarning: null,
    }
  }

  if (record?.code === 'DUAL_STACK_CONFLICT') {
    const warning =
      parseAuthConfigWarningFromResponseBody(body) ||
      '检测到 OAuth 与服务账号同时存在，请先在设置页删除其中一种配置后再使用。'
    return {
      message: warning,
      needsReauth: false,
      authConfigWarning: warning,
    }
  }

  return {
    message: buildGoogleAdsApiErrorMessage(
      response,
      body,
      options?.fallbackMessage || '获取账号列表失败'
    ),
    needsReauth: false,
    authConfigWarning: parseAuthConfigWarningFromResponseBody(body),
  }
}

/** @throws Error — 可选附带 `needsReauth` 供调用方展示重授权 UI */
export function throwAccountsListFetchError(
  response: Response,
  body: unknown | null,
  options?: { fallbackMessage?: string }
): never {
  const { message, needsReauth, authConfigWarning } = parseAccountsListFetchFailure(
    response,
    body,
    options
  )
  const error = new Error(message) as Error & {
    needsReauth?: boolean
    authConfigWarning?: string | null
  }
  if (needsReauth) error.needsReauth = true
  if (authConfigWarning) error.authConfigWarning = authConfigWarning
  throw error
}

/** 异步轮询时每隔 N 次刷新一次凭证状态，避免 auth_type 长期过期 */
export const GOOGLE_ADS_CREDENTIALS_POLL_REFRESH_EVERY = 5

export type ParsedGoogleAdsCredentialsStatus = {
  /** 未配置或双栈时服务端不下发，客户端也不应默认 oauth */
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  hasCredentials: boolean
  authConfigWarning: string | null
}

function resolveParsedCredentialsAuthType(payload: Record<string, unknown>): {
  authType?: 'oauth' | 'service_account'
} {
  if (payload.authType === 'service_account' || payload.authType === 'oauth') {
    return { authType: payload.authType }
  }

  const authConfigWarning = formatNullableErrorMessage(payload.authConfigWarning)
  if (authConfigWarning) {
    return {}
  }

  if (!payload.hasCredentials) {
    return {}
  }

  if (payload.hasRefreshToken) {
    return { authType: 'oauth' }
  }
  if (payload.hasServiceAccount) {
    return { authType: 'service_account' }
  }

  return {}
}

/** 解析 GET /api/google-ads/credentials 的 JSON（需已校验 response.ok） */
export function parseCredentialsStatusResponse(data: unknown): ParsedGoogleAdsCredentialsStatus {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  const payload =
    record?.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : null

  if (!record?.success || !payload) {
    return {
      hasCredentials: false,
      authConfigWarning: null,
    }
  }

  const authConfigWarning = formatNullableErrorMessage(payload.authConfigWarning)
  const { authType } = resolveParsedCredentialsAuthType(payload)

  return {
    ...(authType ? { authType } : {}),
    serviceAccountId: payload.serviceAccountId ? String(payload.serviceAccountId) : undefined,
    hasCredentials: Boolean(payload.hasCredentials),
    authConfigWarning,
  }
}

function credentialsStatusErrorMessage(data: unknown, fallback = '获取凭证状态失败'): string {
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

export type AccountsRequestAuth = {
  authType: 'oauth' | 'service_account'
  serviceAccountId?: string
}

export const GOOGLE_ADS_MISSING_SERVICE_ACCOUNT_MESSAGE = '未找到服务账号配置，请前往设置页面配置'

export const GOOGLE_ADS_NOT_CONFIGURED_MESSAGE =
  'Google Ads 认证未配置或已失效，请先在设置中完成 OAuth 授权或配置服务账号'

/**
 * 合并凭证快照与 UI 侧的 service_account_id 补全（仅当状态已是 SA 且 id 缺失时）。
 * 不改变 authType，也不是 OAuth 失效后回退到服务账号。
 */
export function buildAuthForAccountsRequest(
  auth: ParsedGoogleAdsCredentialsStatus,
  fallbackServiceAccountId?: string | null
): AccountsRequestAuth {
  if (auth.authType !== 'service_account') {
    if (!auth.authType) {
      throw new Error(GOOGLE_ADS_NOT_CONFIGURED_MESSAGE)
    }
    return {
      authType: auth.authType,
      serviceAccountId: auth.serviceAccountId,
    }
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

export type AccountsRequestAuthResolution =
  | { ok: false; reason: 'auth_config_warning'; authConfigWarning: string }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'invalid_auth'; message: string }
  | { ok: true; authForRequest: AccountsRequestAuth }

export function accountsRequestBlockedMessage(
  resolution: Exclude<AccountsRequestAuthResolution, { ok: true }>
): string | null {
  if (resolution.reason === 'invalid_auth') {
    return resolution.message
  }
  if (resolution.reason === 'not_configured') {
    return GOOGLE_ADS_NOT_CONFIGURED_MESSAGE
  }
  return null
}

export type AccountsFetchBlockedUiEffects = {
  authConfigWarning?: string
  errorMessage?: string
  clearForceRefreshState?: boolean
}

/** 客户端 accounts 拉取预检失败时的 UI 副作用（便于单测） */
export function resolveAccountsFetchBlockedUiEffects(
  resolution: Exclude<AccountsRequestAuthResolution, { ok: true }>,
  opts?: { forceRefresh?: boolean }
): AccountsFetchBlockedUiEffects {
  const effects: AccountsFetchBlockedUiEffects = {}
  if (resolution.reason === 'auth_config_warning') {
    effects.authConfigWarning = resolution.authConfigWarning
  }
  const errorMessage = accountsRequestBlockedMessage(resolution)
  if (errorMessage) {
    effects.errorMessage = errorMessage
  }
  if (opts?.forceRefresh) {
    effects.clearForceRefreshState = true
  }
  return effects
}

/** 拉 accounts 前的统一预检：双栈 / 未配置 / SA id 缺失 */
export function resolveAccountsRequestAuth(
  auth: ParsedGoogleAdsCredentialsStatus,
  fallbackServiceAccountId?: string | null
): AccountsRequestAuthResolution {
  if (auth.authConfigWarning) {
    return { ok: false, reason: 'auth_config_warning', authConfigWarning: auth.authConfigWarning }
  }
  if (!auth.hasCredentials) {
    return { ok: false, reason: 'not_configured' }
  }
  try {
    const authForRequest = buildAuthForAccountsRequest(auth, fallbackServiceAccountId)
    assertAccountsRequestAuth(authForRequest)
    return { ok: true, authForRequest }
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid_auth',
      message: error instanceof Error ? error.message : GOOGLE_ADS_MISSING_SERVICE_ACCOUNT_MESSAGE,
    }
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
