type AuthType = 'oauth' | 'service_account'

interface ResolveLoginCustomerIdParams {
  authType: AuthType
  accountParentMccId?: unknown
  oauthLoginCustomerId?: unknown
  serviceAccountMccId?: unknown
}

interface ResolveLoginCustomerCandidatesParams extends ResolveLoginCustomerIdParams {
  targetCustomerId?: unknown
}

function normalizeId(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const normalized = String(value).trim()
  return normalized || undefined
}

function dedupeIds(values: Array<string | undefined>): Array<string | undefined> {
  const result: Array<string | undefined> = []
  const seen = new Set<string>()

  for (const value of values) {
    const key = value === undefined ? '__OMIT_LOGIN_CUSTOMER_ID__' : value
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }

  return result
}

/**
 * 解析 Google Ads login-customer-id。
 *
 * 关键规则：
 * 1) 账号有 parent_mcc_id 时优先使用（与选中子账号绑定，支持多MCC）
 * 2) OAuth 模式下 parent 缺失时回退到凭证里的 login_customer_id
 * 3) 服务账号模式优先使用服务账号配置里的 MCC，缺失时回退到 parent
 */
export function resolveLoginCustomerId(params: ResolveLoginCustomerIdParams): string | undefined {
  const parentMccId = normalizeId(params.accountParentMccId)

  if (params.authType === 'service_account') {
    const serviceAccountMccId = normalizeId(params.serviceAccountMccId)
    return serviceAccountMccId || parentMccId
  }

  const oauthLoginCustomerId = normalizeId(params.oauthLoginCustomerId)
  return parentMccId || oauthLoginCustomerId
}

/**
 * 返回 login_customer_id 候选列表（按优先级排序）。
 * - OAuth：parent_mcc -> oauth_login_customer_id -> target_customer_id -> 省略header
 * - 服务账号：service_account_mcc -> parent_mcc -> target_customer_id -> 省略header
 */
export function resolveLoginCustomerCandidates(
  params: ResolveLoginCustomerCandidatesParams
): Array<string | undefined> {
  const primary = resolveLoginCustomerId(params)
  const oauthLoginCustomerId = normalizeId(params.oauthLoginCustomerId)
  const serviceAccountMccId = normalizeId(params.serviceAccountMccId)
  const parentMccId = normalizeId(params.accountParentMccId)
  const targetCustomerId = normalizeId(params.targetCustomerId)

  if (params.authType === 'service_account') {
    return dedupeIds([
      primary,
      serviceAccountMccId,
      parentMccId,
      targetCustomerId,
      undefined,
    ])
  }

  return dedupeIds([
    primary,
    oauthLoginCustomerId,
    targetCustomerId,
    undefined,
  ])
}

function collectErrorMessages(error: any): string {
  const messages: string[] = []

  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      messages.push(value.toLowerCase())
    }
  }

  push(error?.message)
  push(error?.cause?.message)
  push(error?.details)

  const addNestedErrors = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      push((item as any)?.message)
      push((item as any)?.details)
    }
  }

  addNestedErrors(error?.errors)

  if (Array.isArray(error?.statusDetails)) {
    for (const detail of error.statusDetails) {
      addNestedErrors(detail?.errors)
    }
  }

  return messages.join('\n')
}

function collectErrorCodeTokens(error: any): Set<string> {
  const tokens = new Set<string>()

  const push = (value: unknown) => {
    if (value === null || value === undefined) return
    const normalized = String(value).trim().toUpperCase()
    if (normalized) tokens.add(normalized)
  }

  const readCodeObject = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const [key, val] of Object.entries(value)) {
      push(key)
      push(val)
    }
  }

  push(error?.status)
  push(error?.statusCode)
  push(error?.response?.status)
  push(error?.response?.statusCode)

  readCodeObject(error?.error_code || error?.errorCode)

  const addNestedErrors = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      readCodeObject((item as any)?.error_code || (item as any)?.errorCode)
    }
  }

  addNestedErrors(error?.errors)

  if (Array.isArray(error?.statusDetails)) {
    for (const detail of error.statusDetails) {
      addNestedErrors(detail?.errors)
    }
  }

  return tokens
}

/**
 * 判断是否为“账号访问权限/层级”相关错误。
 * 用于 login_customer_id 自动降级重试。
 */
export function isGoogleAdsAccountAccessError(error: unknown): boolean {
  const err = error as any
  const codeTokens = collectErrorCodeTokens(err)

  const hasAccessCode = Array.from(codeTokens).some(code => (
    code === '7' || // gRPC PERMISSION_DENIED
    code.includes('PERMISSION_DENIED') ||
    code.includes('ACCESS_DENIED') ||
    code.includes('AUTHORIZATION_ERROR') ||
    code.includes('AUTHENTICATION_ERROR') ||
    code.includes('LOGIN_CUSTOMER_ID') ||
    code.includes('USER_PERMISSION_DENIED') ||
    code.includes('CUSTOMER_NOT_ENABLED') ||
    code.includes('CUSTOMER_NOT_FOUND')
  ))

  if (hasAccessCode) return true

  const combined = collectErrorMessages(err)
  return combined.includes("user doesn't have permission to access customer")
    || (combined.includes('login-customer-id') && combined.includes('access customer'))
    || (combined.includes('permission denied') && combined.includes('customer'))
    || combined.includes('permission_denied')
    || combined.includes('customer_not_enabled')
    || combined.includes('customer not enabled')
    || combined.includes('not yet enabled')
    || combined.includes('deactivated')
}
