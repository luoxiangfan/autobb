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
